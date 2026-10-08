const { parseBody, renderTemplate, splitText } = require("./content");
const { getTemplate, templateValues } = require("./templates");
const { readLocalImage } = require("../media");

const API_URL = "https://api.telegram.org";
const MESSAGE_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const ALBUM_LIMIT = 10;

function config() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    testChatId: process.env.TELEGRAM_TEST_CHAT_ID,
    rhash: process.env.TELEGRAM_IV_RHASH,
  };
}

function isConfigured() {
  const { token, chatId } = config();
  return Boolean(token && chatId);
}

function canTest() {
  const { token, testChatId } = config();
  return Boolean(token && testChatId);
}

async function call(method, payload) {
  const isForm = payload instanceof FormData;
  const response = await fetch(`${API_URL}/bot${config().token}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? payload : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!data?.ok) throw new Error(`Telegram: ${data?.description || `HTTP ${response.status}`}`);
  return data.result;
}

function previewOptions(setting, url) {
  if (!setting) return { is_disabled: true };
  const options = { prefer_large_media: Boolean(setting.large), show_above_text: Boolean(setting.above) };
  if (url) options.url = url;
  return options;
}

function previewSetting(post, template) {
  const chosen = post.options?.telegram?.preview;
  if (chosen === false) return false;
  if (chosen === true) return template.preview || {};
  return template.preview;
}

function instantViewLink(link) {
  const { rhash } = config();
  if (!link || !rhash) return link;
  return `https://t.me/iv?url=${encodeURIComponent(link)}&rhash=${encodeURIComponent(rhash)}`;
}

function textParts(text, entities) {
  return splitText(text, entities, MESSAGE_LIMIT).map((chunk) => ({ kind: "text", text: chunk.text, entities: chunk.entities }));
}

function imageParts(sources, caption) {
  const parts = [];
  for (let start = 0; start < sources.length; start += ALBUM_LIMIT) {
    const group = sources.slice(start, start + ALBUM_LIMIT);
    parts.push({ kind: group.length === 1 ? "photo" : "album", sources: group, caption: start === 0 ? caption : null });
  }
  return parts;
}

function buildPlan(post, link, sources) {
  const template = getTemplate("telegram", post.type);
  const silent = post.options?.telegram?.silent === true;
  const previewDefault = Boolean(template.preview);

  if (post.type !== "short") {
    const opened = instantViewLink(link);
    const { text, entities } = renderTemplate(template.text, templateValues(post, "telegram", template.locale, opened, link));
    const preview = opened ? previewOptions(previewSetting(post, template), opened) : { is_disabled: true };
    return { parts: textParts(text, entities), preview, above: true, silent, previewDefault, length: text.length, limit: MESSAGE_LIMIT };
  }

  const { text, entities } = renderTemplate(template.text, templateValues(post, "telegram", template.locale, link, link));
  const preview = previewOptions(previewSetting(post, template), null);
  const above = template.captionAbove !== false;
  let parts;
  if (!sources.length) parts = textParts(text, entities);
  else if (!text) parts = imageParts(sources, null);
  else if (text.length <= CAPTION_LIMIT) parts = imageParts(sources, { text, entities });
  else parts = [...textParts(text, entities), ...imageParts(sources, null)];
  const limit = sources.length ? CAPTION_LIMIT : MESSAGE_LIMIT;
  return { parts, preview, above, silent, previewDefault, length: text.length, limit };
}

function captionFields(caption, above) {
  if (!caption) return {};
  return { caption: caption.text, caption_entities: caption.entities, show_caption_above_media: above };
}

function imageForm(chatId, plan) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (plan.silent) form.append("disable_notification", "true");
  return form;
}

function attach(form, name, src) {
  const image = readLocalImage(src);
  if (!image) throw new Error("Telegram: an image file is missing");
  form.append(name, new Blob([image.buffer], { type: image.type }), image.name);
}

async function sendPart(part, plan, chatId) {
  if (part.kind === "text") {
    const message = await call("sendMessage", {
      chat_id: chatId,
      text: part.text,
      entities: part.entities,
      link_preview_options: plan.preview,
      disable_notification: plan.silent,
    });
    return [message];
  }
  const form = imageForm(chatId, plan);
  if (part.kind === "photo") {
    attach(form, "photo", part.sources[0]);
    for (const [key, value] of Object.entries(captionFields(part.caption, plan.above))) {
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    return [await call("sendPhoto", form)];
  }
  const media = part.sources.map((src, index) => {
    attach(form, `photo${index}`, src);
    return { type: "photo", media: `attach://photo${index}`, ...(index === 0 ? captionFields(part.caption, plan.above) : {}) };
  });
  form.append("media", JSON.stringify(media));
  return call("sendMediaGroup", form);
}

async function execute(plan, chatId) {
  if (!plan.parts.length) throw new Error("Telegram: nothing to send");
  const messages = [];
  for (const part of plan.parts) messages.push(...(await sendPart(part, plan, chatId)));
  return messages;
}

function localSources(post) {
  return parseBody(post.body).images.filter((src) => readLocalImage(src));
}

async function share(post, link) {
  const sources = localSources(post);
  const messages = await execute(buildPlan(post, link, sources), config().chatId);
  const chat = messages[0]?.chat;
  return {
    message_ids: messages.map((message) => message.message_id),
    chat_id: chat?.id,
    chat_username: chat?.username,
    images: sources,
  };
}

async function sendTest(post, link) {
  await execute(buildPlan(post, link, localSources(post)), config().testChatId);
}

function preview(post, link) {
  const plan = buildPlan(post, link, parseBody(post.body).images);
  return {
    parts: plan.parts,
    above: plan.above,
    length: plan.length,
    limit: plan.limit,
    preview_default: plan.previewDefault,
  };
}

function partSize(part) {
  return part.kind === "text" ? 1 : part.sources.length;
}

async function edit(method, payload) {
  try {
    await call(method, payload);
  } catch (error) {
    if (!/message is not modified/i.test(error.message)) throw error;
  }
}

async function update(post, shared, link) {
  const sources = localSources(post);
  const changed = "Telegram: images or length changed, delete the post there and post it again";
  if (shared.images && (shared.images.length !== sources.length || shared.images.some((src, index) => src !== sources[index]))) {
    throw new Error(changed);
  }
  const plan = buildPlan(post, link, sources);
  const ids = shared.message_ids || [];
  if (plan.parts.reduce((total, part) => total + partSize(part), 0) !== ids.length) throw new Error(changed);

  const chatId = shared.chat_id ?? config().chatId;
  let position = 0;
  let captioned = false;
  for (const part of plan.parts) {
    const messageId = ids[position];
    position += partSize(part);
    if (part.kind === "text") {
      await edit("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: part.text,
        entities: part.entities,
        link_preview_options: plan.preview,
      });
    } else if (!captioned) {
      captioned = true;
      await edit("editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption: part.caption?.text || "",
        caption_entities: part.caption?.entities || [],
        show_caption_above_media: plan.above,
      });
    }
  }
}

function postUrl(result) {
  const id = result.message_ids?.[0];
  if (!id) return null;
  const chat = String(result.chat_id ?? config().chatId ?? "");
  const username = result.chat_username || (chat.startsWith("@") ? chat.slice(1) : null);
  if (username) return `https://t.me/${username}/${id}`;
  const internal = /^-100(\d+)$/.exec(chat);
  return internal ? `https://t.me/c/${internal[1]}/${id}` : null;
}

async function remove(result) {
  const chatId = result.chat_id ?? config().chatId;
  for (const id of result.message_ids || []) {
    try {
      await call("deleteMessage", { chat_id: chatId, message_id: id });
    } catch (error) {
      if (!/message to delete not found/i.test(error.message)) throw error;
    }
  }
}

async function exists(result) {
  const chatId = result.chat_id ?? config().chatId;
  for (const id of result.message_ids || []) {
    try {
      await call("editMessageReplyMarkup", { chat_id: chatId, message_id: id });
      return true;
    } catch (error) {
      if (/message is not modified/i.test(error.message)) return true;
      if (!/message to edit not found/i.test(error.message)) throw error;
    }
  }
  return false;
}

let cachedName = null;

async function profile() {
  if (!cachedName) cachedName = (await call("getChat", { chat_id: config().chatId })).title || null;
  return { name: cachedName };
}

module.exports = { isConfigured, canTest, share, sendTest, preview, update, postUrl, remove, exists, profile };

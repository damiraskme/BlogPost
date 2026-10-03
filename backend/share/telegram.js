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
    rhash: process.env.TELEGRAM_IV_RHASH,
  };
}

function isConfigured() {
  const { token, chatId } = config();
  return Boolean(token && chatId);
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

async function sendText(text, entities, preview) {
  const ids = [];
  for (const chunk of splitText(text, entities, MESSAGE_LIMIT)) {
    const message = await call("sendMessage", {
      chat_id: config().chatId,
      text: chunk.text,
      entities: chunk.entities,
      link_preview_options: preview,
    });
    ids.push(message.message_id);
  }
  return ids;
}

function captionFields(caption, above) {
  if (!caption) return {};
  return { caption: caption.text, caption_entities: caption.entities, show_caption_above_media: above };
}

async function sendPhoto(image, caption, above) {
  const form = new FormData();
  form.append("chat_id", config().chatId);
  form.append("photo", new Blob([image.buffer], { type: image.type }), image.name);
  for (const [key, value] of Object.entries(captionFields(caption, above))) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const message = await call("sendPhoto", form);
  return [message.message_id];
}

async function sendAlbum(images, caption, above) {
  const form = new FormData();
  form.append("chat_id", config().chatId);
  const media = images.map((image, index) => {
    form.append(`photo${index}`, new Blob([image.buffer], { type: image.type }), image.name);
    return { type: "photo", media: `attach://photo${index}`, ...(index === 0 ? captionFields(caption, above) : {}) };
  });
  form.append("media", JSON.stringify(media));
  const messages = await call("sendMediaGroup", form);
  return messages.map((message) => message.message_id);
}

async function sendImages(images, caption, above) {
  const ids = [];
  for (let start = 0; start < images.length; start += ALBUM_LIMIT) {
    const group = images.slice(start, start + ALBUM_LIMIT);
    const groupCaption = start === 0 ? caption : null;
    ids.push(...(group.length === 1 ? await sendPhoto(group[0], groupCaption, above) : await sendAlbum(group, groupCaption, above)));
  }
  return ids;
}

function instantViewLink(link) {
  const { rhash } = config();
  if (!link || !rhash) return link;
  return `https://t.me/iv?url=${encodeURIComponent(link)}&rhash=${encodeURIComponent(rhash)}`;
}

async function shareShort(post, link) {
  const template = getTemplate("telegram", "short");
  const { text, entities } = renderTemplate(template.text, templateValues(post, template.locale, link, link));
  const files = parseBody(post.body).images.map(readLocalImage).filter(Boolean);
  const preview = previewOptions(template.preview, null);
  const above = template.captionAbove !== false;
  if (!files.length) {
    if (!text) throw new Error("Telegram: nothing to send");
    return { message_ids: await sendText(text, entities, preview) };
  }
  if (!text) return { message_ids: await sendImages(files, null, above) };
  if (text.length <= CAPTION_LIMIT) return { message_ids: await sendImages(files, { text, entities }, above) };
  const textIds = await sendText(text, entities, preview);
  const imageIds = await sendImages(files, null, above);
  return { message_ids: [...textIds, ...imageIds] };
}

async function shareArticle(post, link) {
  const template = getTemplate("telegram", "article");
  const opened = instantViewLink(link);
  const { text, entities } = renderTemplate(template.text, templateValues(post, template.locale, opened, link));
  if (!text) throw new Error("Telegram: the article template produced no text");
  const preview = opened ? previewOptions(template.preview, opened) : { is_disabled: true };
  return { message_ids: await sendText(text, entities, preview) };
}

module.exports = { isConfigured, shareShort, shareArticle };

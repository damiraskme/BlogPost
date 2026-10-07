const { parseBody, renderTemplate, toPlainText } = require("./content");
const { getTemplate, templateValues } = require("./templates");
const { readLocalImage } = require("../media");

const API_URL = "https://api.linkedin.com";
const DEFAULT_VERSION = "202609";
const COMMENTARY_LIMIT = 3000;
const MULTI_IMAGE_LIMIT = 20;
const SUPPORTED_TYPES = ["image/png", "image/jpeg"];

let cachedAuthor = null;

function config() {
  return {
    token: process.env.LINKEDIN_ACCESS_TOKEN,
    author: process.env.LINKEDIN_AUTHOR_URN,
    version: process.env.LINKEDIN_VERSION || DEFAULT_VERSION,
  };
}

function isConfigured() {
  return Boolean(config().token);
}

function headers(extra) {
  const { token, version } = config();
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  };
}

async function check(response) {
  if (response.ok) return response;
  let message = null;
  try {
    message = JSON.parse(await response.text()).message;
  } catch {}
  if (response.status === 401) message = "access token is invalid or expired, generate a new one";
  throw new Error(`LinkedIn: ${message || `HTTP ${response.status}`}`);
}

async function getAuthor() {
  if (config().author) return config().author;
  if (cachedAuthor) return cachedAuthor;
  const response = await fetch(`${API_URL}/v2/userinfo`, { headers: { Authorization: `Bearer ${config().token}` } });
  if (response.status === 403) {
    throw new Error("LinkedIn: the token cannot read your profile id; generate it with the openid and profile scopes, or set LINKEDIN_AUTHOR_URN");
  }
  const { sub } = await (await check(response)).json();
  cachedAuthor = `urn:li:person:${sub}`;
  return cachedAuthor;
}

async function uploadImage(owner, image) {
  const init = await check(
    await fetch(`${API_URL}/rest/images?action=initializeUpload`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    }),
  );
  const { value } = await init.json();
  await check(
    await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${config().token}`, "Content-Type": image.type },
      body: image.buffer,
    }),
  );
  return value.image;
}

async function createPost(author, commentary, content) {
  const body = {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) body.content = content;
  const response = await check(
    await fetch(`${API_URL}/rest/posts`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }),
  );
  return response.headers.get("x-restli-id");
}

function escapeText(text) {
  return text.replace(/[\\|{}@[\]()<>*_~]|#(?![\p{L}\p{N}])/gu, "\\$&");
}

function commentary(post, type, link) {
  const template = getTemplate("linkedin", type);
  const text = toPlainText(renderTemplate(template.text, templateValues(post, template.locale, link, link)));
  if (text.length > COMMENTARY_LIMIT) throw new Error(`LinkedIn: text is longer than ${COMMENTARY_LIMIT} characters`);
  return text;
}

function supportedImages(sources) {
  const images = sources.map(readLocalImage).filter(Boolean);
  const supported = images.filter((image) => SUPPORTED_TYPES.includes(image.type));
  return { supported, skipped: images.length - supported.length };
}

function skippedNote(skipped) {
  return skipped ? `${skipped} WebP image(s) skipped, LinkedIn only accepts PNG and JPEG` : undefined;
}

function mediaContent(ids) {
  if (ids.length === 1) return { media: { id: ids[0] } };
  if (ids.length > 1) return { multiImage: { images: ids.map((id) => ({ id })) } };
  return null;
}

async function shareShort(post, link) {
  const text = commentary(post, "short", link);
  const { supported, skipped } = supportedImages(parseBody(post.body).images);
  if (supported.length > MULTI_IMAGE_LIMIT) throw new Error(`LinkedIn: at most ${MULTI_IMAGE_LIMIT} images per post`);
  if (!text && !supported.length) throw new Error("LinkedIn: nothing to send");

  const author = await getAuthor();
  const ids = [];
  for (const image of supported) ids.push(await uploadImage(author, image));
  return { post_id: await createPost(author, escapeText(text), mediaContent(ids)), note: skippedNote(skipped) };
}

async function shareArticle(post, link) {
  const text = commentary(post, "article", link);
  const author = await getAuthor();
  const { supported, skipped } = supportedImages(parseBody(post.body).images);
  const thumbnail = supported.length ? await uploadImage(author, supported[0]) : null;
  const notes = [];
  if (!supported.length && skipped) notes.push("no thumbnail, LinkedIn only accepts PNG and JPEG");

  let content;
  if (link) {
    content = { article: { source: link, title: post.title, description: post.excerpt } };
    if (thumbnail) content.article.thumbnail = thumbnail;
  } else {
    content = mediaContent(thumbnail ? [thumbnail] : []);
    notes.push("SITE_URL is not set, posted without a link");
  }
  return { post_id: await createPost(author, escapeText(text), content), note: notes.join("; ") || undefined };
}

function postUrl(result) {
  return result.post_id ? `https://www.linkedin.com/feed/update/${result.post_id}/` : null;
}

async function remove(result) {
  if (!result.post_id) return;
  const response = await fetch(`${API_URL}/rest/posts/${encodeURIComponent(result.post_id)}`, {
    method: "DELETE",
    headers: headers({ "X-RestLi-Method": "DELETE" }),
  });
  if (response.status !== 404) await check(response);
}

async function exists(result) {
  if (!result.post_id) return false;
  const response = await fetch(`${API_URL}/rest/posts/${encodeURIComponent(result.post_id)}`, { headers: headers() });
  if (response.status === 404) return false;
  if (response.status === 403) throw new Error("LinkedIn does not let this token read posts, so it cannot be checked");
  await check(response);
  return true;
}

module.exports = { isConfigured, shareShort, shareArticle, postUrl, remove, exists };

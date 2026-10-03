const fs = require("fs");
const path = require("path");
const { parseBody } = require("./share/content");

const DATA_DIR = path.join(__dirname, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const POST_TYPES = ["short", "article"];
const MAX_TITLE_LENGTH = 200;
const EXCERPT_LENGTH = 200;
const PREVIEW_LENGTH = 600;
const SLUG_LENGTH = 60;

const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function invalid(detail) {
  return Object.assign(new Error(detail), { status: 400 });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, file);
}

function readPosts() {
  return readJson(POSTS_FILE, []);
}

function writePosts(posts) {
  writeJson(POSTS_FILE, posts);
}

function readDrafts() {
  return readJson(DRAFTS_FILE, []);
}

function writeDrafts(drafts) {
  writeJson(DRAFTS_FILE, drafts);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function toText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
}

function makeExcerpt(text) {
  if (text.length <= EXCERPT_LENGTH) return text;
  return `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function makeSlug(title, id, posts) {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/, "");
  if (!base) return `post-${id}`;
  if (posts.some((post) => post.slug === base)) return `${base}-${id}`;
  return base;
}

function makePreview(text) {
  if (text.length <= PREVIEW_LENGTH) return { preview: text, truncated: false };
  const cut = text.slice(0, PREVIEW_LENGTH);
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  const kept = boundary > PREVIEW_LENGTH / 2 ? cut.slice(0, boundary) : cut;
  return { preview: `${kept.trimEnd()}…`, truncated: true };
}

function summarize(post) {
  const { text, images } = parseBody(post.body);
  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title,
    created_at: post.created_at,
    shares: post.shares,
    pending_delete: post.pending_delete,
    body: post.body,
    ...makePreview(text),
    image: images[0] || null,
    image_count: images.length,
  };
}

function listPosts() {
  return readPosts()
    .sort((a, b) => b.id - a.id)
    .map(summarize);
}

function getPost(slug) {
  return readPosts().find((post) => post.slug === slug) || null;
}

function postFields(input) {
  if (!input || typeof input !== "object") throw invalid("Invalid post");
  const { type, body } = input;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!POST_TYPES.includes(type)) throw invalid("Unknown post type");
  if (typeof body !== "string") throw invalid("Body is required");
  if (title.length > MAX_TITLE_LENGTH) throw invalid("Header is too long");
  if (type === "article" && !title) throw invalid("Header is required for an article");
  const text = toText(body);
  if (!text && !/<img\b/i.test(body)) throw invalid("Body is required");
  return { type, title, body, excerpt: makeExcerpt(text) };
}

function createPost(input) {
  const fields = postFields(input);
  const posts = readPosts();
  const id = nextId(posts);
  const post = {
    id,
    slug: makeSlug(fields.title, id, posts),
    ...fields,
    created_at: new Date().toISOString(),
  };
  posts.push(post);
  writePosts(posts);
  return post;
}

function updatePost(slug, input) {
  const fields = postFields(input);
  const posts = readPosts();
  const post = posts.find((item) => item.slug === slug);
  if (!post) return null;
  Object.assign(post, fields, { updated_at: new Date().toISOString() });
  writePosts(posts);
  return post;
}

function deletePost(slug) {
  const posts = readPosts();
  const post = posts.find((item) => item.slug === slug);
  if (!post) return false;
  writePosts(posts.filter((item) => item !== post));
  const drafts = readDrafts();
  const remaining = drafts.filter((draft) => draft.post_id !== post.id);
  if (remaining.length < drafts.length) writeDrafts(remaining);
  return true;
}

function setShare(id, network, result) {
  const posts = readPosts();
  const post = posts.find((item) => item.id === id);
  if (!post) return null;
  post.shares = { ...post.shares, [network]: result };
  writePosts(posts);
  return post;
}

function patchPost(id, changes) {
  const posts = readPosts();
  const post = posts.find((item) => item.id === id);
  if (!post) return null;
  Object.assign(post, changes);
  writePosts(posts);
  return post;
}

function listDrafts() {
  return readDrafts()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(({ id, post_id, title, type, updated_at }) => ({ id, post_id: post_id ?? null, title, type, updated_at }));
}

function getDraft(id) {
  return readDrafts().find((draft) => draft.id === id) || null;
}

function saveDraft(input) {
  if (!input || typeof input !== "object") throw invalid("Invalid draft");
  const title = typeof input.title === "string" ? input.title.slice(0, MAX_TITLE_LENGTH) : "";
  const type = POST_TYPES.includes(input.type) ? input.type : "article";
  const body = typeof input.body === "string" ? input.body : "";
  const share = Array.isArray(input.share) ? input.share.filter((name) => typeof name === "string") : [];

  const postId = Number.isInteger(input.post_id) ? input.post_id : null;
  if (postId !== null && !readPosts().some((post) => post.id === postId)) throw invalid("Post not found");

  const drafts = readDrafts();
  const existing = drafts.find(
    (draft) => (draft.post_id ?? null) === postId && draft.title.trim() === title.trim() && draft.body === body,
  );
  const draft = existing || { id: nextId(drafts) };
  Object.assign(draft, { post_id: postId, title, type, body, share, updated_at: new Date().toISOString() });
  if (!existing) drafts.push(draft);
  writeDrafts(drafts);
  return { ...draft, duplicate: Boolean(existing) };
}

function deleteDraft(id) {
  const drafts = readDrafts();
  const remaining = drafts.filter((draft) => draft.id !== id);
  if (remaining.length === drafts.length) return false;
  writeDrafts(remaining);
  return true;
}

function usedBodies() {
  return [...readPosts(), ...readDrafts()].map((item) => item.body);
}

function getSettings() {
  const settings = readJson(SETTINGS_FILE, {});
  return { share: settings.share && typeof settings.share === "object" ? settings.share : {} };
}

function saveSettings(input) {
  const share = {};
  for (const [name, enabled] of Object.entries(input?.share || {})) share[name] = Boolean(enabled);
  const settings = { ...getSettings(), share };
  writeJson(SETTINGS_FILE, settings);
  return settings;
}

module.exports = {
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  setShare,
  patchPost,
  listDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  usedBodies,
  getSettings,
  saveSettings,
};

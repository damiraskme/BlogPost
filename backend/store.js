const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const POST_TYPES = ["short", "article"];
const MAX_TITLE_LENGTH = 200;
const EXCERPT_LENGTH = 200;
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

function readPosts() {
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function writePosts(posts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${POSTS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(posts, null, 2));
  fs.renameSync(tempFile, POSTS_FILE);
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

function summarize(post) {
  const summary = {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title,
    created_at: post.created_at,
  };
  if (post.type === "short") summary.body = post.body;
  else summary.excerpt = post.excerpt;
  return summary;
}

function listPosts() {
  return readPosts()
    .sort((a, b) => b.id - a.id)
    .map(summarize);
}

function getPost(slug) {
  return readPosts().find((post) => post.slug === slug) || null;
}

function createPost(input) {
  if (!input || typeof input !== "object") throw invalid("Invalid post");
  const { type, body } = input;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!POST_TYPES.includes(type)) throw invalid("Unknown post type");
  if (typeof body !== "string") throw invalid("Body is required");
  if (title.length > MAX_TITLE_LENGTH) throw invalid("Header is too long");
  if (type === "article" && !title) throw invalid("Header is required for an article");
  const text = toText(body);
  if (!text && !/<img\b/i.test(body)) throw invalid("Body is required");

  const posts = readPosts();
  const id = posts.reduce((max, post) => Math.max(max, post.id), 0) + 1;
  const post = {
    id,
    slug: makeSlug(title, id, posts),
    type,
    title,
    body,
    excerpt: makeExcerpt(text),
    created_at: new Date().toISOString(),
  };
  posts.push(post);
  writePosts(posts);
  return post;
}

module.exports = { listPosts, getPost, createPost };

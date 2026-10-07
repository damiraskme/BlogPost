import { listPage, postUrl, formatDate } from "./api.js";
import { splitBody, imageStrip, updateStrip } from "./strip.js";

const MAX_CARDS = 3;

const cards = document.getElementById("posts");
const recent = document.getElementById("recent");
const status = document.getElementById("status");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function label(post) {
  return post.title || post.preview.slice(0, 50) || "untitled";
}

function renderRecent(post) {
  const item = element("p", undefined, "recent-item");
  const link = element("a", label(post));
  link.href = postUrl(post.slug);
  item.append(link, element("span", formatDate(post.created_at), "date"));
  return item;
}

function renderCard(post) {
  const card = element("article", undefined, "home-post");
  const url = postUrl(post.slug);
  const { content, sources } = splitBody(post.body);

  if (sources.length) {
    const images = element("div", undefined, "home-post-images");
    images.append(imageStrip(sources));
    card.append(images);
  }

  const text = element("div", undefined, "home-post-text");
  if (post.title) {
    const heading = element("h3");
    const link = element("a", post.title);
    link.href = url;
    heading.append(link);
    text.append(heading);
  }
  const body = element("div", undefined, "post-body");
  body.append(content);
  text.append(body);
  card.append(text);
  return card;
}

function updateStrips() {
  for (const wrap of cards.querySelectorAll(".thumbs-wrap")) updateStrip(wrap);
}

async function load() {
  const { posts } = await listPage(1);
  if (!posts.length) status.textContent = "No posts yet.";
  recent.append(...posts.map(renderRecent));
  cards.append(...posts.slice(0, MAX_CARDS).map(renderCard));
  updateStrips();
  window.addEventListener("resize", updateStrips);
  for (const image of cards.querySelectorAll("img")) image.addEventListener("load", updateStrips);
}

load().catch((error) => {
  status.textContent = error.message;
});

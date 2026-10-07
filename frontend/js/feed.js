import { listPage, postUrl, formatDate } from "./api.js";
import { shareLinks } from "./links.js";
import { openLightbox } from "./lightbox.js";

const SHORT_LINES = 15;
const ARTICLE_LINES = 8;
const MAX_THUMBS = 3;

const list = document.getElementById("posts");
const status = document.getElementById("status");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function splitBody(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const content = template.content;
  const sources = [];
  for (const image of content.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (src) sources.push(src);
    let parent = image.parentNode;
    image.remove();
    while (parent && parent !== content && !parent.textContent.trim() && !parent.querySelector("img")) {
      const next = parent.parentNode;
      parent.remove();
      parent = next;
    }
  }
  return { content, sources };
}

function imageLink(sources, position, url) {
  const link = element("a");
  link.href = url;
  link.addEventListener("click", (event) => {
    if (link.closest(".post").classList.contains("clipped")) return;
    event.preventDefault();
    openLightbox(sources, position);
  });
  return link;
}

function renderThumbs(sources, url) {
  const thumbs = element("div", undefined, "thumbs");
  sources.slice(0, MAX_THUMBS).forEach((src, position) => {
    const link = imageLink(sources, position, url);
    const image = element("img");
    image.src = src;
    image.alt = "";
    link.append(image);
    thumbs.append(link);
  });
  if (sources.length > MAX_THUMBS) {
    const more = imageLink(sources, MAX_THUMBS, url);
    more.textContent = `+${sources.length - MAX_THUMBS}`;
    thumbs.append(more);
  }

  const wrap = element("div", undefined, "thumbs-wrap");
  const left = element("button", "‹", "thumb-arrow left");
  const right = element("button", "›", "thumb-arrow right");
  for (const [button, direction] of [[left, -1], [right, 1]]) {
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-label", direction < 0 ? "Previous images" : "Next images");
    button.addEventListener("click", () => {
      thumbs.scrollBy({ left: direction * thumbs.clientWidth * 0.8, behavior: "smooth" });
    });
  }
  thumbs.addEventListener("scroll", () => updateThumbs(wrap));
  wrap.append(left, thumbs, right);
  return wrap;
}

function updateThumbs(wrap) {
  const thumbs = wrap.querySelector(".thumbs");
  const moreLeft = thumbs.scrollLeft > 1;
  const moreRight = thumbs.scrollLeft + thumbs.clientWidth < thumbs.scrollWidth - 1;
  wrap.classList.toggle("more-left", moreLeft);
  wrap.classList.toggle("more-right", moreRight);
  wrap.querySelector(".thumb-arrow.left").hidden = !moreLeft;
  wrap.querySelector(".thumb-arrow.right").hidden = !moreRight;
}

function renderPost(post) {
  const article = element("article", undefined, "post");
  const url = postUrl(post.slug);
  article.dataset.lines = post.type === "article" ? ARTICLE_LINES : SHORT_LINES;

  const head = element("div", undefined, "post-head");
  if (post.title) {
    const heading = element("h2");
    const link = element("a", post.title);
    link.href = url;
    heading.append(link);
    head.append(heading);
  }
  head.append(element("span", formatDate(post.created_at), "date"), shareLinks(post));

  const { content, sources } = splitBody(post.body);
  const text = element("div", undefined, "post-body post-text");
  text.append(content);
  const wrapper = element("div", undefined, "post-content");
  wrapper.append(text);
  if (sources.length) {
    article.classList.add("has-thumbs");
    wrapper.append(renderThumbs(sources, url));
  }
  const fade = element("div", undefined, "fade");
  const read = element("a", "Read...", "read");
  read.href = url;
  fade.hidden = true;
  read.hidden = true;
  wrapper.append(fade, read);

  article.append(head, wrapper);
  return article;
}

function clipPosts() {
  for (const article of list.children) {
    const text = article.querySelector(".post-text");
    text.style.maxHeight = "";
    const limit = Number(article.dataset.lines) * parseFloat(getComputedStyle(text).lineHeight);
    const clipped = text.scrollHeight > limit + 1;
    if (clipped) text.style.maxHeight = `${limit}px`;
    article.classList.toggle("clipped", clipped);
    article.querySelector(".fade").hidden = !clipped;
    article.querySelector(".read").hidden = !clipped;
    const wrap = article.querySelector(".thumbs-wrap");
    if (wrap) updateThumbs(wrap);
  }
}

function pageNumbers(current, total) {
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  if (total <= 7) for (let number = 1; number <= total; number += 1) wanted.add(number);
  return [...wanted].filter((number) => number >= 1 && number <= total).sort((a, b) => a - b);
}

function renderPager(current, total) {
  const pager = document.getElementById("pager");
  if (total < 2) return;
  let previous = 0;
  for (const number of pageNumbers(current, total)) {
    if (number - previous > 1) pager.append(element("span", "…"));
    const item = element(number === current ? "strong" : "a", String(number));
    if (number !== current) item.href = number === 1 ? "/blog" : `/blog?page=${number}`;
    pager.append(item);
    previous = number;
  }
}

async function load() {
  const requested = parseInt(new URLSearchParams(location.search).get("page"), 10) || 1;
  const { posts, page, pages } = await listPage(requested);
  if (!posts.length) status.textContent = "No posts yet.";
  list.append(...posts.map(renderPost));
  renderPager(page, pages);
  clipPosts();
  window.addEventListener("resize", clipPosts);
}

load().catch((error) => {
  status.textContent = error.message;
});

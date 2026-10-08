const ENTITY_TAGS = {
  bold: "b",
  italic: "i",
  underline: "u",
  strikethrough: "s",
  code: "code",
  pre: "code",
  text_link: "a",
};

const ENTITY_CLASSES = {
  spoiler: "spoiler",
  blockquote: "quote",
  expandable_blockquote: "quote",
  text_link: "auto-link",
};

const AUTO_LINK = /(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+|@[A-Za-z0-9_]{3,})/gu;
const LINKEDIN_ROWS = { 1: [1], 2: [2], 3: [1, 2], 4: [1, 3] };
const VIEWS_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c-5.5 0-9.3 4.1-10.5 7 1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.300 9.100 17.500 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.500a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function autoLink(text) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(AUTO_LINK)) {
    fragment.append(text.slice(last, match.index), element("span", match[0], "auto-link"));
    last = match.index + match[0].length;
  }
  fragment.append(text.slice(last));
  return fragment;
}

function renderRich(text, entities) {
  const fragment = document.createDocumentFragment();
  const points = new Set([0, text.length]);
  for (const entity of entities || []) {
    points.add(entity.offset);
    points.add(entity.offset + entity.length);
  }
  const sorted = [...points].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const active = (entities || []).filter((entity) => entity.offset <= start && entity.offset + entity.length >= end);
    const linked = active.some((entity) => entity.type === "text_link");
    let node = linked ? document.createTextNode(text.slice(start, end)) : autoLink(text.slice(start, end));
    for (const entity of active) {
      const wrapper = element(ENTITY_TAGS[entity.type] || "span");
      if (ENTITY_CLASSES[entity.type]) wrapper.className = ENTITY_CLASSES[entity.type];
      if (entity.type === "text_link") {
        wrapper.href = entity.url;
        wrapper.target = "_blank";
        wrapper.rel = "noopener";
      }
      wrapper.append(node);
      node = wrapper;
    }
    fragment.append(node);
  }
  return fragment;
}

function picture(src) {
  const image = element("img");
  image.src = src;
  image.alt = "";
  return image;
}

function avatar(name) {
  return element("div", (name.trim()[0] || "?").toUpperCase(), "preview-avatar");
}

function currentTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function telegramMedia(sources) {
  const grid = element("div", undefined, `tg-media count-${Math.min(sources.length, 4)}`);
  if (sources.length > 2 && sources.length % 2) grid.classList.add("odd");
  grid.append(...sources.map(picture));
  return grid;
}

function telegramMessage(part, above) {
  const bubble = element("div", undefined, "tg-message");
  const meta = element("div", undefined, "tg-meta");
  meta.innerHTML = VIEWS_ICON;
  meta.prepend("1 ");
  meta.append(` ${currentTime()}`);

  if (part.kind === "text") {
    const text = element("div", undefined, "tg-text");
    text.append(renderRich(part.text, part.entities), meta);
    bubble.append(text);
    return bubble;
  }
  const media = telegramMedia(part.sources);
  if (!part.caption) {
    meta.classList.add("on-media");
    media.append(meta);
    bubble.append(media);
    return bubble;
  }
  const text = element("div", undefined, "tg-text");
  text.append(renderRich(part.caption.text, part.caption.entities));
  if (above) {
    meta.classList.add("on-media");
    media.append(meta);
    bubble.append(text, media);
  } else {
    text.append(meta);
    bubble.append(media, text);
  }
  return bubble;
}

function renderTelegram(target, data, name) {
  const head = element("div", undefined, "tg-head");
  const titles = element("div");
  titles.append(element("div", name, "tg-name"), element("div", "channel", "tg-sub"));
  head.append(avatar(name), titles);
  const chat = element("div", undefined, "tg-chat");
  if (data.error) chat.append(element("div", data.error, "tg-service"));
  else chat.append(element("div", "Today", "tg-service"), ...data.parts.map((part) => telegramMessage(part, data.above)));
  target.replaceChildren(head, chat);
  chat.scrollTop = chat.scrollHeight;
}

function linkedinMedia(sources) {
  const rows = LINKEDIN_ROWS[sources.length] || [2, 3];
  const shown = rows.reduce((total, count) => total + count, 0);
  const media = element("div", undefined, "li-media");
  let position = 0;
  for (const count of rows) {
    const row = element("div", undefined, "li-media-row");
    for (const src of sources.slice(position, position + count)) {
      const cell = element("div", undefined, "li-media-cell");
      cell.append(picture(src));
      row.append(cell);
    }
    position += count;
    media.append(row);
  }
  if (sources.length > shown) media.lastChild.lastChild.append(element("span", `+${sources.length - shown}`, "li-more-images"));
  return media;
}

function linkedinText(text) {
  const wrap = element("div", undefined, "li-text-wrap");
  const block = element("div", undefined, "li-text clamped");
  block.append(autoLink(text));
  const more = element("button", "…more", "li-more");
  more.type = "button";
  more.hidden = true;
  more.addEventListener("click", () => {
    block.classList.remove("clamped");
    more.hidden = true;
  });
  wrap.append(block, more);
  requestAnimationFrame(() => {
    more.hidden = block.scrollHeight <= block.clientHeight + 1;
  });
  return wrap;
}

function linkedinArticle(article, images) {
  const card = element("div", undefined, "li-article");
  if (images.length) card.append(picture(images[0]));
  const details = element("div", undefined, "li-article-text");
  let host = article.source;
  try {
    host = new URL(article.source).host;
  } catch {}
  details.append(element("div", article.title, "li-article-title"), element("div", host, "li-article-host"));
  card.append(details);
  return card;
}

function renderLinkedin(target, data, images, name) {
  const feed = element("div", undefined, "li-feed");
  if (data.error) {
    feed.append(element("div", data.error, "li-error"));
    return target.replaceChildren(feed);
  }
  const card = element("div", undefined, "li-card");
  const head = element("div", undefined, "li-head");
  const titles = element("div");
  titles.append(element("div", name, "li-name"), element("div", "now • 🌐", "li-sub"));
  head.append(avatar(name), titles);
  card.append(head);
  if (data.text) card.append(linkedinText(data.text));
  if (data.article) card.append(linkedinArticle(data.article, images));
  else if (images.length) card.append(linkedinMedia(images));
  const actions = element("div", undefined, "li-actions");
  actions.append(...["Like", "Comment", "Repost", "Send"].map((label) => element("span", label)));
  card.append(actions);
  feed.append(card);
  target.replaceChildren(feed);
}

export function renderPreview(data, context) {
  renderTelegram(document.getElementById("preview-telegram"), data.telegram, context.names.telegram);
  renderLinkedin(document.getElementById("preview-linkedin"), data.linkedin, context.linkedinImages, context.names.linkedin);
}

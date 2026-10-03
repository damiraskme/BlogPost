const { STYLES, styleChar } = require("./styles");

const BLOCK_TAGS = new Set(["div", "p", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);

const INLINE_TYPES = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  ins: "underline",
  s: "strikethrough",
  strike: "strikethrough",
  del: "strikethrough",
  code: "code",
  pre: "pre",
  blockquote: "blockquote",
  "tg-spoiler": "spoiler",
  a: "text_link",
};

const NAMED_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const PLACEHOLDER = /\{(\w+)(?::([\w,-]+))?\}/g;
const CONDITIONAL = /\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g;

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}

function rawAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s/>])`, "i"));
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function rebuild(rich, replace) {
  let text = "";
  const map = [];
  for (let index = 0; index < rich.text.length; ) {
    const char = String.fromCodePoint(rich.text.codePointAt(index));
    for (let unit = 0; unit < char.length; unit += 1) map[index + unit] = text.length;
    text += replace(char, index);
    index += char.length;
  }
  map[rich.text.length] = text.length;
  const entities = rich.entities
    .map((entity) => ({ ...entity, offset: map[entity.offset], length: map[entity.offset + entity.length] - map[entity.offset] }))
    .filter((entity) => entity.length > 0);
  return { text, entities };
}

function normalize(rich) {
  const start = rich.text.search(/\S/);
  if (start === -1) return { text: "", entities: [] };
  const end = rich.text.trimEnd().length;
  let newlines = 0;
  return rebuild(rich, (char, index) => {
    if (index < start || index >= end) return "";
    if (char === "\n") {
      newlines += 1;
      return newlines > 2 ? "" : char;
    }
    if (char.trim()) newlines = 0;
    return char;
  });
}

function applyStyles(rich, styles) {
  return styles.reduce((current, style) => rebuild(current, (char) => styleChar(char, style)), rich);
}

function toRich(value) {
  if (value && typeof value === "object") return value;
  return { text: value ? String(value) : "", entities: [] };
}

function fillAttribute(value, values) {
  if (!values || value === null) return value;
  return value.replace(PLACEHOLDER, (match, name) => (Object.hasOwn(values, name) ? toRich(values[name]).text : match));
}

function render(markup, values) {
  let text = "";
  const entities = [];
  const open = [];
  const images = [];

  const append = (rich) => {
    for (const entity of rich.entities) entities.push({ ...entity, offset: entity.offset + text.length });
    text += rich.text;
  };

  const appendText = (raw) => {
    if (!values) return append(toRich(decodeEntities(raw).replace(/ /g, " ")));
    let last = 0;
    for (const match of raw.matchAll(PLACEHOLDER)) {
      const [whole, name, modifiers] = match;
      if (!Object.hasOwn(values, name)) continue;
      append(toRich(decodeEntities(raw.slice(last, match.index))));
      const styles = (modifiers || "").split(",").filter((style) => STYLES.includes(style));
      append(applyStyles(toRich(values[name]), styles));
      last = match.index + whole.length;
    }
    append(toRich(decodeEntities(raw.slice(last))));
  };

  const source = values ? markup.replace(CONDITIONAL, (match, name, inner) => (toRich(values[name]).text ? inner : "")) : markup;

  for (const token of source.split(/(<[^>]*>)/)) {
    if (!token) continue;
    if (!token.startsWith("<")) {
      appendText(token);
      continue;
    }
    const match = token.match(/^<\s*(\/?)\s*([a-z0-9-]+)/i);
    if (!match) continue;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    const type = INLINE_TYPES[name];

    if (name === "br") {
      text += "\n";
      continue;
    }
    if (name === "img") {
      const src = rawAttribute(token, "src");
      if (src) images.push(src);
      continue;
    }
    if (BLOCK_TAGS.has(name) && !closing && text && !text.endsWith("\n")) text += "\n";
    if (type && !closing) {
      const expandable = name === "blockquote" && rawAttribute(token, "expandable") !== null;
      open.push({
        name,
        type: expandable ? "expandable_blockquote" : type,
        offset: text.length,
        url: name === "a" ? fillAttribute(rawAttribute(token, "href"), values) : null,
      });
    }
    if (type && closing) {
      const index = open.findLastIndex((entry) => entry.name === name);
      if (index !== -1) {
        const [entry] = open.splice(index, 1);
        const length = text.length - entry.offset;
        if (length > 0 && entry.type !== "text_link") entities.push({ type: entry.type, offset: entry.offset, length });
        if (length > 0 && entry.type === "text_link" && /^https?:\/\//i.test(entry.url || "")) {
          entities.push({ type: "text_link", offset: entry.offset, length, url: entry.url });
        }
      }
    }
    if (BLOCK_TAGS.has(name) && closing && text && !text.endsWith("\n")) text += "\n";
  }

  return { ...normalize({ text, entities }), images };
}

function parseBody(html) {
  return render(html, null);
}

function renderTemplate(template, values) {
  const { text, entities } = render(template, values);
  return { text, entities };
}

function sliceEntities(entities, start, end) {
  return entities.flatMap((entity) => {
    const from = Math.max(entity.offset, start);
    const to = Math.min(entity.offset + entity.length, end);
    return to > from ? [{ ...entity, offset: from - start, length: to - from }] : [];
  });
}

function splitText(text, entities, limit) {
  const chunks = [];
  const push = (start, end) => {
    if (text.slice(start, end).trim()) chunks.push({ text: text.slice(start, end), entities: sliceEntities(entities, start, end) });
  };
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      const space = text.lastIndexOf(" ", end);
      const cut = newline > start + limit / 2 ? newline : space > start ? space : -1;
      if (cut !== -1) {
        push(start, cut);
        start = cut + 1;
        continue;
      }
      if (/[\ud800-\udbff]/.test(text[end - 1])) end -= 1;
    }
    push(start, end);
    start = end;
  }
  return chunks;
}

function toPlainText(rich) {
  const styled = rebuild(rich, (char, index) => {
    const active = new Set(
      rich.entities.filter((entity) => index >= entity.offset && index < entity.offset + entity.length).map((entity) => entity.type),
    );
    if (active.has("code") || active.has("pre")) return styleChar(char, "mono");
    if (active.has("bold") && active.has("italic")) return styleChar(char, "sans-bold-italic");
    if (active.has("bold")) return styleChar(char, "sans-bold");
    if (active.has("italic")) return styleChar(char, "sans-italic");
    return char;
  });
  let { text } = styled;
  const links = styled.entities.filter((entity) => entity.type === "text_link").sort((a, b) => b.offset - a.offset);
  for (const link of links) {
    const end = link.offset + link.length;
    if (text.slice(link.offset, end) !== link.url) text = `${text.slice(0, end)} (${link.url})${text.slice(end)}`;
  }
  return text;
}

function firstImage(html) {
  return parseBody(html).images[0] || null;
}

module.exports = { parseBody, renderTemplate, splitText, toPlainText, firstImage };

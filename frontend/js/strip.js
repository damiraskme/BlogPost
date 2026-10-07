import { openLightbox } from "./lightbox.js";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function splitBody(html) {
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

export function updateStrip(wrap) {
  const thumbs = wrap.querySelector(".thumbs");
  const moreLeft = thumbs.scrollLeft > 1;
  const moreRight = thumbs.scrollLeft + thumbs.clientWidth < thumbs.scrollWidth - 1;
  wrap.classList.toggle("more-left", moreLeft);
  wrap.classList.toggle("more-right", moreRight);
  wrap.querySelector(".thumb-arrow.left").hidden = !moreLeft;
  wrap.querySelector(".thumb-arrow.right").hidden = !moreRight;
}

export function imageStrip(sources, { limit = sources.length, href, opens = () => true } = {}) {
  const imageLink = (position) => {
    const link = element("a");
    link.href = href || sources[position];
    link.addEventListener("click", (event) => {
      if (!opens(link)) return;
      event.preventDefault();
      openLightbox(sources, position);
    });
    return link;
  };

  const thumbs = element("div", undefined, "thumbs");
  sources.slice(0, limit).forEach((src, position) => {
    const link = imageLink(position);
    const image = element("img");
    image.src = src;
    image.alt = "";
    link.append(image);
    thumbs.append(link);
  });
  if (sources.length > limit) {
    const more = imageLink(limit);
    more.textContent = `+${sources.length - limit}`;
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
  thumbs.addEventListener("scroll", () => updateStrip(wrap));
  wrap.append(left, thumbs, right);
  return wrap;
}

import { createPost, uploadImage, logout, postUrl } from "./api.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const title = document.getElementById("title");
const body = document.getElementById("body");
const publish = document.getElementById("publish");
const status = document.getElementById("status");

function fail(error) {
  if (error.status === 401) location.href = "/login";
  else status.textContent = error.message;
}

function hasFiles(event) {
  return [...event.dataTransfer.types].includes("Files");
}

function endOfBody() {
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  return range;
}

function insideBody(range) {
  return Boolean(range) && body.contains(range.startContainer);
}

function currentRange() {
  const selection = getSelection();
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  return insideBody(range) ? range : endOfBody();
}

function rangeFromPoint(x, y) {
  let range = null;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  } else if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  }
  return insideBody(range) ? range : endOfBody();
}

function insertNode(range, node) {
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

async function insertImages(files, range) {
  const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
  if (images.length < files.length) status.textContent = "Only PNG, JPEG and WebP images are supported";
  else status.textContent = "";
  for (const file of images) {
    try {
      const { url } = await uploadImage(file);
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      insertNode(range, image);
    } catch (error) {
      fail(error);
    }
  }
}

body.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  const files = [...event.clipboardData.files];
  if (text) document.execCommand("insertText", false, text);
  else if (files.length) insertImages(files, currentRange());
});

body.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  insertImages([...event.dataTransfer.files], rangeFromPoint(event.clientX, event.clientY));
});

window.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (hasFiles(event)) event.preventDefault();
});

publish.addEventListener("click", async () => {
  publish.disabled = true;
  status.textContent = "";
  try {
    const post = await createPost({
      title: title.value,
      type: document.querySelector("input[name=type]:checked").value,
      body: body.innerHTML,
    });
    location.href = postUrl(post.slug);
  } catch (error) {
    publish.disabled = false;
    fail(error);
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await logout().catch(() => null);
  location.href = "/";
});

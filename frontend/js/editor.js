import {
  createPost,
  updatePost,
  getPost,
  sharePost,
  unsharePost,
  uploadImage,
  logout,
  getSession,
  getSettings,
  listDrafts,
  getDraft,
  saveDraft,
  deleteDraft,
  postUrl,
  NETWORK_NAMES,
} from "./api.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const title = document.getElementById("title");
const body = document.getElementById("body");
const publish = document.getElementById("publish");
const saveButton = document.getElementById("save-draft");
const status = document.getElementById("status");

const localImages = new Map();
let draggingInside = false;
let draftId = null;
let editing = null;
let dirty = false;

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

function placeCaret(range) {
  body.focus();
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function acceptedImages(files) {
  const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
  const fitting = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
  if (images.length < files.length) status.textContent = "Only PNG, JPEG and WebP images are supported";
  else if (fitting.length < images.length) status.textContent = "Images must be 5 MB or smaller";
  else status.textContent = "";
  return fitting;
}

function insertImages(files) {
  const html = acceptedImages(files)
    .map((file) => {
      const src = URL.createObjectURL(file);
      localImages.set(src, { file, url: null });
      return `<img src="${src}" alt="">`;
    })
    .join("");
  if (html) document.execCommand("insertHTML", false, html);
}

async function buildBody() {
  const copy = body.cloneNode(true);
  for (const image of copy.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    if (!src.startsWith("blob:")) continue;
    const local = localImages.get(src);
    if (!local) {
      image.remove();
      continue;
    }
    if (!local.url) local.url = (await uploadImage(local.file)).url;
    image.setAttribute("src", local.url);
  }
  return copy.innerHTML;
}

body.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  if (text) document.execCommand("insertText", false, text);
  else insertImages([...event.clipboardData.files]);
});

body.addEventListener("dragstart", () => {
  draggingInside = true;
});

body.addEventListener("dragend", () => {
  draggingInside = false;
});

body.addEventListener("drop", (event) => {
  if (draggingInside || !hasFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  placeCaret(rangeFromPoint(event.clientX, event.clientY));
  insertImages([...event.dataTransfer.files]);
});

window.addEventListener("dragover", (event) => {
  if (!draggingInside && hasFiles(event)) event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (!draggingInside && hasFiles(event)) event.preventDefault();
});

function selectedType() {
  return document.querySelector("input[name=type]:checked").value;
}

function selectedNetworks() {
  return [...document.querySelectorAll("input[name=share]:checked")].map((input) => input.value);
}

function showNetworks(networks, checked) {
  const container = document.getElementById("networks");
  for (const network of networks) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "share";
    checkbox.value = network;
    checkbox.checked = checked(network);
    label.append(checkbox, ` Share to ${NETWORK_NAMES[network] || network} `);
    container.append(label);
  }
}

function showPostNetworks(networks) {
  const container = document.getElementById("post-networks");
  container.replaceChildren(
    ...networks.map((network) => {
      const name = NETWORK_NAMES[network] || network;
      const url = editing.links[network];
      const line = document.createElement("p");
      const button = document.createElement("button");
      button.type = "button";
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "posted";
        line.append(`${name}: `, link, " ");
        button.textContent = `Delete from ${name}`;
      } else {
        line.append(`${name}: not posted `);
        button.textContent = `Post to ${name}`;
      }
      button.addEventListener("click", async () => {
        if (!url && dirty) {
          status.textContent = "Save changes first. The saved version of the post is what gets posted.";
          return;
        }
        if (url && !confirm(`Delete this post from ${name}?`)) return;
        button.disabled = true;
        status.textContent = url ? "Deleting..." : "Posting...";
        try {
          editing = url ? await unsharePost(editing.slug, network) : await sharePost(editing.slug, network);
          const result = editing.shares[network];
          status.textContent = result.ok ? "" : result.error;
        } catch (error) {
          fail(error);
        }
        showPostNetworks(networks);
      });
      line.append(button);
      return line;
    }),
  );
}

function editorUrl(id) {
  const params = new URLSearchParams();
  if (editing) params.set("post", editing.slug);
  if (id) params.set("draft", id);
  const query = params.toString();
  return query ? `/new?${query}` : "/new";
}

function setDraftUrl(id) {
  history.replaceState(null, "", editorUrl(id));
}

function fill(content) {
  title.value = content?.title || "";
  body.innerHTML = content?.body || "";
  if (content) document.querySelector(`input[name=type][value=${content.type}]`).checked = true;
}

function resetEditor() {
  draftId = null;
  fill(editing);
  dirty = false;
  setDraftUrl(null);
}

async function removeDraft(draft) {
  if (!confirm(`Delete draft "${draft.title || "untitled"}"?`)) return;
  try {
    await deleteDraft(draft.id);
    if (draft.id === draftId) resetEditor();
    await showDrafts();
  } catch (error) {
    fail(error);
  }
}

async function showDrafts() {
  const drafts = (await listDrafts()).filter((draft) => draft.post_id === (editing?.id ?? null));
  const list = document.getElementById("draft-list");
  document.getElementById("drafts").hidden = !drafts.length;
  list.replaceChildren(
    ...drafts.map((draft) => {
      const line = document.createElement("p");
      const link = document.createElement("a");
      link.href = editorUrl(draft.id);
      link.textContent = draft.title || "untitled";
      const when = new Date(draft.updated_at).toLocaleString();
      const remove = document.createElement("button");
      remove.textContent = "Delete";
      remove.addEventListener("click", () => removeDraft(draft));
      line.append(link, ` ${draft.type}, saved ${when}${draft.id === draftId ? " (open)" : ""} `, remove);
      return line;
    }),
  );
}

async function saveCurrentDraft() {
  saveButton.disabled = true;
  status.textContent = "Saving...";
  try {
    const draft = await saveDraft({
      post_id: editing?.id ?? null,
      title: title.value,
      type: selectedType(),
      body: await buildBody(),
      share: selectedNetworks(),
    });
    draftId = draft.id;
    dirty = false;
    setDraftUrl(draftId);
    const time = new Date(draft.updated_at).toLocaleTimeString();
    status.textContent = draft.duplicate ? `Already saved as a draft, updated at ${time}` : `Draft saved at ${time}`;
    await showDrafts();
  } catch (error) {
    fail(error);
  } finally {
    saveButton.disabled = false;
  }
}

async function load() {
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get("draft"));
  const slug = params.get("post");

  if (slug) {
    editing = await getPost(slug).catch(() => null);
    if (!editing) status.textContent = "Post not found";
  }
  if (editing) {
    document.title = "Edit post";
    document.getElementById("mode").textContent = `Editing post: ${editing.title || editing.slug}`;
    document.getElementById("drafts-title").textContent = "Drafts of this post";
    publish.textContent = "Save changes";
    showPostNetworks(session.networks);
  }

  const found = requested ? await getDraft(requested).catch(() => null) : null;
  const draft = found && (found.post_id ?? null) === (editing?.id ?? null) ? found : null;

  if (draft) {
    draftId = draft.id;
    fill(draft);
  } else {
    if (requested) status.textContent = "Draft not found";
    fill(editing);
    setDraftUrl(null);
  }
  if (!editing) {
    showNetworks(session.networks, (network) => (draft ? draft.share.includes(network) : settings.share[network] ?? true));
  }
  await showDrafts();
}

publish.addEventListener("click", async () => {
  publish.disabled = true;
  status.textContent = editing ? "Saving..." : "Publishing...";
  try {
    const fields = {
      title: title.value,
      type: selectedType(),
      body: await buildBody(),
      share: selectedNetworks(),
      draft_id: draftId,
    };
    const post = editing ? await updatePost(editing.slug, fields) : await createPost(fields);
    dirty = false;
    location.href = postUrl(post.slug);
  } catch (error) {
    publish.disabled = false;
    fail(error);
  }
});

saveButton.addEventListener("click", saveCurrentDraft);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!saveButton.disabled) saveCurrentDraft();
  }
});

for (const element of [title, body, document.getElementById("networks")]) {
  element.addEventListener("input", () => {
    dirty = true;
  });
}

for (const radio of document.querySelectorAll("input[name=type]")) {
  radio.addEventListener("change", () => {
    dirty = true;
  });
}

window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});

load().catch(fail);

document.getElementById("logout").addEventListener("click", async () => {
  await logout().catch(() => null);
  location.href = "/blog";
});

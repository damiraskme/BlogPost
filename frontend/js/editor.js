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
  previewPost,
  testShare,
  getAutosave,
  setAutosave,
  deleteAutosave,
  getProfiles,
  postUrl,
  NETWORK_NAMES,
} from "./api.js";
import { renderPreview } from "./preview.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALBUM_LIMIT = 10;
const PREVIEW_DELAY = 400;
const AUTOSAVE_DELAY = 3000;
const OVERRIDES = ["telegram", "linkedin"];
const PREVIEW_MODES = ["telegram", "linkedin", "both"];
const MODE_KEY = "preview-mode";

const byId = (id) => document.getElementById(id);

const title = byId("title");
const body = byId("body");
const areas = { all: body, telegram: byId("body-telegram"), linkedin: byId("body-linkedin") };
const publish = byId("publish");
const saveButton = byId("save-draft");
const testButton = byId("send-test");
const discardButton = byId("discard");
const status = byId("status");
const trayElement = byId("tray");
const linkPopup = byId("link-popup");
const linkInput = byId("link-url");
const silentBox = byId("telegram-silent");
const previewBox = byId("telegram-preview");

const localImages = new Map();
let tray = [];
let activeTab = "all";
let headerOpen = false;
let previewTouched = false;
let draggingInside = false;
let draggedIndex = null;
let savedRange = null;
let draftId = null;
let editing = null;
let session = { networks: [], test: [] };
const names = { telegram: "Channel", linkedin: "You" };
let dirty = false;
let unsynced = false;
let previewTimer = null;
let autosaveTimer = null;
let previewRequest = 0;

function fail(error) {
  if (error.status === 401) location.href = "/login";
  else status.textContent = error.message;
}

function selectedType() {
  return document.querySelector("input[name=type]:checked").value;
}

function isShort() {
  return selectedType() === "short";
}

function activeArea() {
  return areas[activeTab];
}

function selectedNetworks() {
  return [...document.querySelectorAll("input[name=share]:checked")].map((input) => input.value);
}

function selectedUpdates() {
  return [...document.querySelectorAll("input[name=update]:checked")].map((input) => input.value);
}

function saveKey() {
  if (editing) return `post-${editing.id}`;
  return draftId ? `draft-${draftId}` : "new";
}

function hasFiles(event) {
  return [...event.dataTransfer.types].includes("Files");
}

function imageType(src) {
  if (src.startsWith("blob:")) return localImages.get(src)?.file.type || "";
  return src.endsWith(".webp") ? "image/webp" : "image/other";
}

function acceptedImages(files) {
  const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
  const fitting = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
  if (images.length < files.length) status.textContent = "Only PNG, JPEG and WebP images are supported";
  else if (fitting.length < images.length) status.textContent = "Images must be 5 MB or smaller";
  else status.textContent = "";
  return fitting;
}

function localSource(file) {
  const src = URL.createObjectURL(file);
  localImages.set(src, { file, url: null });
  return src;
}

async function uploadedSource(src) {
  if (!src.startsWith("blob:")) return src;
  const local = localImages.get(src);
  if (!local) return null;
  if (!local.url) local.url = (await uploadImage(local.file)).url;
  return local.url;
}

function renderTray() {
  const linkedin = selectedNetworks().includes("linkedin") || Boolean(editing);
  trayElement.hidden = !isShort();
  trayElement.replaceChildren(
    ...tray.map((src, index) => {
      const item = document.createElement("div");
      item.className = "tray-item";
      item.draggable = true;
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      image.draggable = false;
      const number = document.createElement("span");
      number.className = "tray-number";
      number.textContent = String(index + 1);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tray-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove image");
      remove.addEventListener("click", () => {
        tray.splice(index, 1);
        renderTray();
        changed();
      });
      item.append(image, number, remove);
      if (linkedin && imageType(src) === "image/webp") {
        const badge = document.createElement("span");
        badge.className = "tray-badge";
        badge.textContent = "not on LinkedIn";
        item.append(badge);
      }
      item.addEventListener("dragstart", () => {
        draggedIndex = index;
      });
      item.addEventListener("dragend", () => {
        draggedIndex = null;
      });
      item.addEventListener("dragover", (event) => {
        if (draggedIndex !== null) event.preventDefault();
      });
      item.addEventListener("drop", (event) => {
        if (draggedIndex === null) return;
        event.preventDefault();
        const [moved] = tray.splice(draggedIndex, 1);
        tray.splice(index, 0, moved);
        draggedIndex = null;
        renderTray();
        changed();
      });
      return item;
    }),
  );
  const note = byId("tray-note");
  const over = isShort() && tray.length > ALBUM_LIMIT;
  note.textContent = over ? `${tray.length} / ${ALBUM_LIMIT} images` : "";
  note.className = over ? "danger-text" : "";
}

function endOfBody() {
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  return range;
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
  return range && body.contains(range.startContainer) ? range : endOfBody();
}

function placeCaret(area, range) {
  area.focus();
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function addImages(files, range) {
  const images = acceptedImages(files);
  if (!images.length) return;
  if (isShort()) {
    tray.push(...images.map(localSource));
    renderTray();
  } else {
    if (range) placeCaret(body, range);
    else body.focus();
    document.execCommand("insertHTML", false, images.map((file) => `<img src="${localSource(file)}" alt="">`).join(""));
  }
  changed();
}

function showHeader() {
  const hide = isShort() && !headerOpen && !title.value;
  title.hidden = hide;
  byId("header-toggle").hidden = !hide;
}

function updateTabs() {
  byId("tabs").hidden = !isShort();
  for (const button of byId("tabs").querySelectorAll("button")) {
    const name = button.dataset.tab;
    button.classList.toggle("active", name === activeTab);
    button.classList.toggle("filled", name !== "all" && Boolean(areas[name].textContent.trim()));
  }
  for (const [name, area] of Object.entries(areas)) area.hidden = name !== activeTab;
  byId("copy-row").hidden = activeTab === "all" || Boolean(activeArea().textContent.trim());
}

function setTab(name) {
  activeTab = name;
  closeLinkPopup();
  updateTabs();
}

function applyType() {
  if (isShort()) {
    for (const image of body.querySelectorAll("img")) {
      const src = image.getAttribute("src");
      if (src) tray.push(src);
      image.remove();
    }
  } else {
    for (const src of tray) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      body.append(image);
    }
    tray = [];
    activeTab = "all";
  }
  showHeader();
  updateTabs();
  renderTray();
}

function overrideHtml(name) {
  return areas[name].textContent.trim() ? areas[name].innerHTML : "";
}

async function collect(upload) {
  const copy = body.cloneNode(true);
  let html;
  if (isShort()) {
    for (const image of copy.querySelectorAll("img")) image.remove();
    const sources = [];
    for (const src of tray) {
      const resolved = upload ? await uploadedSource(src) : src;
      if (resolved) sources.push(resolved);
    }
    const text = copy.textContent.trim() ? copy.innerHTML : "";
    html = text + sources.map((src) => `<img src="${src}">`).join("");
  } else {
    for (const image of copy.querySelectorAll("img")) {
      const src = image.getAttribute("src") || "";
      const resolved = upload ? await uploadedSource(src) : src;
      if (resolved) image.setAttribute("src", resolved);
      else image.remove();
    }
    html = copy.innerHTML;
  }
  const telegram = { silent: silentBox.checked };
  if (previewTouched) telegram.preview = previewBox.checked;
  return {
    title: title.value,
    type: selectedType(),
    body: html,
    overrides: isShort() ? Object.fromEntries(OVERRIDES.map((name) => [name, overrideHtml(name)])) : {},
    options: { telegram },
    share: selectedNetworks(),
  };
}

function linkedinImages() {
  const sources = isShort() ? tray : [...body.querySelectorAll("img")].map((image) => image.getAttribute("src"));
  return sources.filter((src) => src && imageType(src) !== "image/webp");
}

function showCounters(data) {
  const container = byId("counters");
  const parts = [];
  for (const [name, result] of Object.entries(data)) {
    if (result.error) continue;
    const item = document.createElement("span");
    const messages = result.parts?.length > 1 ? `, ${result.parts.length} messages` : "";
    item.textContent = `${NETWORK_NAMES[name] || name} ${result.length} / ${result.limit}${messages}`;
    if (result.length > result.limit) item.className = "danger-text";
    parts.push(item);
  }
  container.replaceChildren(...parts.flatMap((item, index) => (index ? [" · ", item] : [item])));
}

async function refreshPreview() {
  const request = (previewRequest += 1);
  try {
    const data = await previewPost(await collect(false));
    if (request !== previewRequest) return;
    renderPreview(data, { linkedinImages: linkedinImages(), names });
    showCounters(data);
    if (!previewTouched && !data.telegram.error) previewBox.checked = data.telegram.preview_default;
  } catch (error) {
    fail(error);
  }
}

async function runAutosave() {
  if (!unsynced) return;
  try {
    const state = await collect(true);
    await setAutosave(saveKey(), state);
    unsynced = false;
    status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    fail(error);
  }
}

function changed() {
  dirty = true;
  unsynced = true;
  updateTabs();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, PREVIEW_DELAY);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DELAY);
}

async function clearAutosave(key) {
  clearTimeout(autosaveTimer);
  unsynced = false;
  await deleteAutosave(key).catch(() => null);
}

function setPreviewMode(mode) {
  const chosen = PREVIEW_MODES.includes(mode) ? mode : PREVIEW_MODES[0];
  byId("workspace").className = `workspace mode-${chosen}`;
  for (const button of byId("preview-mode").querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.mode === chosen);
  }
  try {
    localStorage.setItem(MODE_KEY, chosen);
  } catch {}
}

function storedPreviewMode() {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

async function loadNames() {
  const profiles = await getProfiles();
  for (const [network, profile] of Object.entries(profiles)) {
    if (profile?.name) names[network] = profile.name;
  }
  refreshPreview();
}

function closeLinkPopup() {
  linkPopup.hidden = true;
  savedRange = null;
}

function openLinkPopup() {
  const selection = getSelection();
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !activeArea().contains(range.commonAncestorContainer)) return;
  savedRange = range.cloneRange();
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  linkInput.value = start.closest("a")?.getAttribute("href") || "";
  linkPopup.hidden = false;
  linkInput.focus();
}

function applyLink(remove) {
  if (!savedRange) return;
  const range = savedRange;
  let url = linkInput.value.trim();
  placeCaret(activeArea(), range);
  if (remove || !url) {
    document.execCommand("unlink");
  } else {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    if (range.collapsed) {
      const link = document.createElement("a");
      link.href = url;
      link.textContent = url;
      document.execCommand("insertHTML", false, link.outerHTML);
    } else {
      document.execCommand("createLink", false, url);
    }
  }
  closeLinkPopup();
  changed();
}

function showNetworks(checked) {
  const container = byId("networks");
  container.replaceChildren(
    ...session.networks.map((network) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "share";
      checkbox.value = network;
      checkbox.checked = checked(network);
      label.append(checkbox, ` Share to ${NETWORK_NAMES[network] || network} `);
      return label;
    }),
  );
  showTelegramOptions();
}

function showTelegramOptions() {
  const relevant = editing ? session.networks.includes("telegram") : selectedNetworks().includes("telegram");
  byId("telegram-options").hidden = !relevant;
}

function showUpdateNetworks() {
  const container = byId("update-networks");
  if (!editing) return container.replaceChildren();
  container.replaceChildren(
    ...session.networks
      .filter((network) => editing.links[network])
      .map((network) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "update";
        checkbox.value = network;
        checkbox.checked = true;
        label.append(checkbox, ` Update on ${NETWORK_NAMES[network] || network} `);
        return label;
      }),
  );
}

function showPostNetworks() {
  const container = byId("post-networks");
  container.replaceChildren(
    ...session.networks.map((network) => {
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
          status.textContent = "Save changes first";
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
        showPostNetworks();
        showUpdateNetworks();
      });
      line.append(button);
      return line;
    }),
  );
}

function showHashtags(sets) {
  byId("hashtags").replaceChildren(
    ...sets.map((set) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = set.name;
      chip.title = set.tags;
      chip.addEventListener("click", () => {
        const area = activeArea();
        const range = document.createRange();
        range.selectNodeContents(area);
        range.collapse(false);
        placeCaret(area, range);
        document.execCommand("insertText", false, `${area.textContent.trim() ? "\n\n" : ""}${set.tags}`);
        changed();
      });
      return chip;
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
  headerOpen = Boolean(title.value);
  body.innerHTML = content?.body || "";
  for (const name of OVERRIDES) areas[name].innerHTML = content?.overrides?.[name] || "";
  if (content) document.querySelector(`input[name=type][value=${content.type}]`).checked = true;
  silentBox.checked = content?.options?.telegram?.silent === true;
  previewTouched = typeof content?.options?.telegram?.preview === "boolean";
  if (previewTouched) previewBox.checked = content.options.telegram.preview;
  tray = [];
  activeTab = "all";
  applyType();
}

async function resetEditor() {
  await clearAutosave(saveKey());
  draftId = null;
  fill(editing);
  dirty = false;
  setDraftUrl(null);
  refreshPreview();
}

async function removeDraft(draft) {
  if (!confirm(`Delete draft "${draft.title || "untitled"}"?`)) return;
  try {
    await deleteDraft(draft.id);
    if (draft.id === draftId) await resetEditor();
    await showDrafts();
  } catch (error) {
    fail(error);
  }
}

async function showDrafts() {
  const drafts = (await listDrafts()).filter((draft) => draft.post_id === (editing?.id ?? null));
  byId("drafts").hidden = !drafts.length;
  byId("draft-list").replaceChildren(
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
    const previousKey = saveKey();
    const draft = await saveDraft({ post_id: editing?.id ?? null, ...(await collect(true)) });
    await clearAutosave(previousKey);
    draftId = draft.id;
    dirty = false;
    discardButton.hidden = true;
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
  const [currentSession, settings] = await Promise.all([getSession(), getSettings()]);
  session = currentSession;
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get("draft"));
  const slug = params.get("post");

  if (slug) {
    editing = await getPost(slug).catch(() => null);
    if (!editing) status.textContent = "Post not found";
  }
  if (editing) {
    document.title = "Edit post";
    byId("mode").textContent = `Editing post: ${editing.title || editing.slug}`;
    byId("drafts-title").textContent = "Drafts of this post";
    publish.textContent = "Save changes";
  }

  const found = requested ? await getDraft(requested).catch(() => null) : null;
  const draft = found && (found.post_id ?? null) === (editing?.id ?? null) ? found : null;
  if (draft) draftId = draft.id;
  else if (requested) status.textContent = "Draft not found";
  if (!draft) setDraftUrl(null);

  const { state } = await getAutosave(saveKey()).catch(() => ({ state: null }));
  const source = state || draft || editing;
  if (source) fill(source);
  else {
    document.querySelector(`input[name=type][value=${settings.default_type}]`).checked = true;
    fill(null);
  }
  if (state) {
    dirty = true;
    discardButton.hidden = false;
  }

  if (editing) {
    showPostNetworks();
    showUpdateNetworks();
    showTelegramOptions();
  } else {
    const shared = source?.share;
    showNetworks((network) => (shared ? shared.includes(network) : settings.share[network] ?? true));
  }
  testButton.hidden = !session.test.includes("telegram");
  showHashtags(settings.hashtags);
  renderTray();
  await showDrafts();
  await refreshPreview();
}

for (const area of Object.values(areas)) {
  area.addEventListener("input", changed);
  area.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
    else addImages([...event.clipboardData.files], null);
  });
}

body.addEventListener("dragstart", () => {
  draggingInside = true;
});

body.addEventListener("dragend", () => {
  draggingInside = false;
});

window.addEventListener("dragover", (event) => {
  if (!draggingInside && hasFiles(event)) event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (draggingInside || !hasFiles(event)) return;
  event.preventDefault();
  const inBody = body.contains(event.target);
  if (!isShort() && !inBody) return;
  addImages([...event.dataTransfer.files], inBody ? rangeFromPoint(event.clientX, event.clientY) : null);
});

title.addEventListener("input", changed);

byId("add-header").addEventListener("click", () => {
  headerOpen = true;
  showHeader();
  title.focus();
});

for (const radio of document.querySelectorAll("input[name=type]")) {
  radio.addEventListener("change", () => {
    applyType();
    changed();
  });
}

for (const button of byId("tabs").querySelectorAll("button")) {
  button.addEventListener("click", () => setTab(button.dataset.tab));
}

for (const button of byId("preview-mode").querySelectorAll("button")) {
  button.addEventListener("click", () => setPreviewMode(button.dataset.mode));
}

byId("copy-main").addEventListener("click", () => {
  const copy = body.cloneNode(true);
  for (const image of copy.querySelectorAll("img")) image.remove();
  activeArea().innerHTML = copy.innerHTML;
  changed();
});

for (const button of byId("toolbar").querySelectorAll("button")) {
  button.addEventListener("mousedown", (event) => event.preventDefault());
}

for (const button of byId("toolbar").querySelectorAll("[data-command]")) {
  button.addEventListener("click", () => {
    activeArea().focus();
    document.execCommand(button.dataset.command);
    changed();
  });
}

byId("link-button").addEventListener("click", openLinkPopup);
byId("link-apply").addEventListener("click", () => applyLink(false));
byId("link-remove").addEventListener("click", () => applyLink(true));

linkInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyLink(false);
  } else if (event.key === "Escape") {
    closeLinkPopup();
  }
});

byId("networks").addEventListener("change", () => {
  showTelegramOptions();
  renderTray();
  changed();
});

silentBox.addEventListener("change", changed);

previewBox.addEventListener("change", () => {
  previewTouched = true;
  changed();
});

publish.addEventListener("click", async () => {
  publish.disabled = true;
  status.textContent = editing ? "Saving..." : "Publishing...";
  try {
    const key = saveKey();
    const fields = { ...(await collect(true)), draft_id: draftId, update: selectedUpdates() };
    const post = editing ? await updatePost(editing.slug, fields) : await createPost(fields);
    await clearAutosave(key);
    dirty = false;
    const failures = Object.entries(post.updates || {}).filter(([, outcome]) => !outcome.ok);
    if (failures.length) {
      editing = post;
      status.textContent = failures.map(([, outcome]) => outcome.error).join("; ");
      publish.disabled = false;
      return;
    }
    location.href = postUrl(post.slug);
  } catch (error) {
    publish.disabled = false;
    fail(error);
  }
});

saveButton.addEventListener("click", saveCurrentDraft);

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  status.textContent = "Sending...";
  try {
    await testShare(await collect(true));
    status.textContent = "Sent";
  } catch (error) {
    fail(error);
  }
  testButton.disabled = false;
});

discardButton.addEventListener("click", async () => {
  await clearAutosave(saveKey());
  location.reload();
});

document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    if (!saveButton.disabled) saveCurrentDraft();
  } else if (key === "k") {
    event.preventDefault();
    openLinkPopup();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (unsynced) event.preventDefault();
});

byId("logout").addEventListener("click", async () => {
  await logout().catch(() => null);
  location.href = "/blog";
});

setPreviewMode(storedPreviewMode());
load().catch(fail);
loadNames().catch(() => null);

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function sendJson(method, path, body) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postJson(path, body) {
  return sendJson("POST", path, body);
}

export function updatePost(slug, post) {
  return sendJson("PUT", `/api/posts/${encodeURIComponent(slug)}`, post);
}

export function deletePost(slug, options) {
  return sendJson("DELETE", `/api/posts/${encodeURIComponent(slug)}`, options);
}

export function editUrl(slug) {
  return `/new?post=${encodeURIComponent(slug)}`;
}

export function listPosts() {
  return request("/api/posts");
}

export function listPage(page) {
  return request(`/api/posts?page=${page}`);
}

export function getPost(slug) {
  return request(`/api/posts/${encodeURIComponent(slug)}`);
}

export function createPost(post) {
  return postJson("/api/posts", post);
}

export function sharePost(slug, network) {
  return postJson(`/api/posts/${encodeURIComponent(slug)}/share`, { network });
}

export function verifyPosts() {
  return postJson("/api/posts/verify", {});
}

export function unsharePost(slug, network) {
  return postJson(`/api/posts/${encodeURIComponent(slug)}/unshare`, { network });
}

export function listDrafts() {
  return request("/api/drafts");
}

export function getDraft(id) {
  return request(`/api/drafts/${id}`);
}

export function saveDraft(draft) {
  return postJson("/api/drafts", draft);
}

export function deleteDraft(id) {
  return request(`/api/drafts/${id}`, { method: "DELETE" });
}

export function getSettings() {
  return request("/api/settings");
}

export function saveSettings(settings) {
  return postJson("/api/settings", settings);
}

export const NETWORK_NAMES = { telegram: "Telegram", linkedin: "LinkedIn" };

export function uploadImage(file) {
  return request("/api/images", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

export function login(username, password) {
  return postJson("/api/login", { username, password });
}

export function logout() {
  return postJson("/api/logout", {});
}

export function getSession() {
  return request("/api/session");
}

export function postUrl(slug) {
  return `/post?slug=${encodeURIComponent(slug)}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function formatDate(iso) {
  const parts = DATE_FORMAT.formatToParts(new Date(iso));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("weekday")} ${value("day")} ${value("month")} ${value("year")}`;
}

export function previewPost(post) {
  return postJson("/api/preview", post);
}

export function testShare(post) {
  return postJson("/api/test-share", post);
}

export function getAutosave(key) {
  return request(`/api/autosave?key=${encodeURIComponent(key)}`);
}

export function setAutosave(key, state) {
  return postJson("/api/autosave", { key, state });
}

export function deleteAutosave(key) {
  return request(`/api/autosave?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

export function getProfiles() {
  return request("/api/profiles");
}

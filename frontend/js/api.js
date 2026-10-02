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

function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listPosts() {
  return request("/api/posts");
}

export function getPost(slug) {
  return request(`/api/posts/${encodeURIComponent(slug)}`);
}

export function createPost(post) {
  return postJson("/api/posts", post);
}

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

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const store = require("./store");
const share = require("./share");
const { firstImage } = require("./share/content");
const { MEDIA_DIR, removeUnused } = require("./media");

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const VERIFY_WORKERS = 4;
const PAGE_SIZE = 5;
const AUTOSAVE_KEY = /^[a-z0-9-]{1,40}$/;

const PAGES = new Map([
  ["/", "home.html"],
  ["/blog", "blog.html"],
  ["/post", "post.html"],
  ["/login", "login.html"],
  ["/posts", "posts.html"],
  ["/new", "new.html"],
  ["/settings", "settings.html"],
]);

const ADMIN_PAGES = new Set(["/posts", "/new", "/settings"]);

const STATIC_PREFIXES = ["/css/", "/js/", "/img/"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const IMAGE_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function httpError(status, detail) {
  return Object.assign(new Error(detail), { status });
}

function siteUrl(req) {
  return (process.env.SITE_URL || `http://${req.headers.host}`).replace(/\/+$/, "");
}

function postLink(req, post) {
  return `${siteUrl(req)}/post?slug=${encodeURIComponent(post.slug)}`;
}

function shareLink(req, post) {
  return process.env.SITE_URL ? postLink(req, post) : null;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function viewPost(post, authenticated) {
  const { shares, pending_delete, ...rest } = post;
  const view = { ...rest, links: share.links(post) };
  if (authenticated) Object.assign(view, { shares: shares || {}, pending_delete: Boolean(pending_delete) });
  return view;
}

async function verifyShares() {
  const tasks = [];
  for (const post of store.listPosts()) {
    for (const [network, shared] of Object.entries(post.shares || {})) {
      if (share.isLive(shared)) tasks.push({ id: post.id, network, shared });
    }
  }

  const unverified = {};
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      const outcome = await share.checkShare(task.network, task.shared);
      if (outcome.state === "unknown") unverified[task.network] = outcome.reason;
      if (outcome.state === "gone") {
        const { delete_error, ...rest } = task.shared;
        store.setShare(task.id, task.network, { ...rest, deleted: true });
      }
    }
  };
  await Promise.all(Array.from({ length: VERIFY_WORKERS }, worker));
  return unverified;
}

async function deletePost(req, res, slug) {
  const post = store.getPost(slug);
  if (!post) throw httpError(404, "Post not found");
  const body = await readBody(req, MAX_JSON_BYTES);
  let input = {};
  try {
    if (body.length) input = JSON.parse(body.toString("utf8")) || {};
  } catch {
    throw httpError(400, "Invalid JSON");
  }

  const shares = { ...post.shares };
  let failed = false;
  const networks = input.force === true || !Array.isArray(input.networks) ? [] : [...new Set(input.networks)];
  for (const network of networks) {
    const shared = shares[network];
    if (!share.isLive(shared)) continue;
    const outcome = await share.removeShare(network, shared);
    const { delete_error, ...rest } = shared;
    shares[network] = outcome.ok ? { ...rest, deleted: true } : { ...rest, delete_error: outcome.error };
    if (!outcome.ok) failed = true;
  }

  if (failed) {
    const updated = store.patchPost(post.id, { shares, pending_delete: true });
    return sendJson(res, 200, { deleted: false, post: viewPost(updated, true) });
  }
  store.deletePost(slug);
  removeUnused(store.usedBodies());
  sendJson(res, 200, { deleted: true });
}

async function shareTo(req, post, networks) {
  let current = post;
  for (const network of networks) {
    const result = await share.sharePost(current, network, shareLink(req, current));
    current = store.setShare(current.id, network, result);
  }
  return current;
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) reject(httpError(413, "Too large"));
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, MAX_JSON_BYTES);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function detectImageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function requireSession(req) {
  if (!auth.getSession(req)) throw httpError(401, "Login required");
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw httpError(403, "Forbidden");
  }
  if (host !== req.headers.host) throw httpError(403, "Forbidden");
}

function serveFile(req, res, baseDir, relativePath) {
  const filePath = path.join(baseDir, relativePath);
  if (!filePath.startsWith(baseDir + path.sep)) throw httpError(404, "Not found");
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw httpError(404, "Not found");
  }
  if (!stats.isFile()) throw httpError(404, "Not found");
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stats.size,
  });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(filePath).pipe(res);
}

async function handleLogin(req, res) {
  const { username, password } = await readJson(req);
  if (typeof username !== "string" || typeof password !== "string") throw httpError(400, "Login and password are required");
  const result = auth.login(req.socket.remoteAddress, username, password);
  if (result.ok) return sendJson(res, 200, { authenticated: true }, { "Set-Cookie": auth.sessionCookie(result.token) });
  if (result.lockedSeconds) {
    const minutes = Math.ceil(result.lockedSeconds / 60);
    throw httpError(429, `Too many attempts. Try again in ${minutes} min.`);
  }
  throw httpError(401, "Wrong login or password");
}

async function handleImageUpload(req, res) {
  const declared = (req.headers["content-type"] || "").split(";")[0].trim();
  if (!IMAGE_EXTENSIONS[declared]) throw httpError(415, "Only PNG, JPEG and WebP images are supported");
  const buffer = await readBody(req, MAX_IMAGE_BYTES);
  const actual = detectImageType(buffer);
  if (!actual) throw httpError(415, "Only PNG, JPEG and WebP images are supported");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const name = hash + IMAGE_EXTENSIONS[actual];
  const filePath = path.join(MEDIA_DIR, name);
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
  sendJson(res, 201, { url: `/media/${name}` });
}

async function handleApi(req, res, pathname, query) {
  const route = `${req.method} ${pathname}`;
  if (req.method !== "GET" && req.method !== "HEAD") requireSameOrigin(req);

  if (route === "GET /api/session") {
    const authenticated = Boolean(auth.getSession(req));
    return sendJson(res, 200, {
      authenticated,
      networks: authenticated ? share.available() : [],
      test: authenticated ? share.testTargets() : [],
    });
  }
  if (route === "POST /api/login") {
    return handleLogin(req, res);
  }
  if (route === "POST /api/logout") {
    auth.logout(req);
    return sendJson(res, 200, { authenticated: false }, { "Set-Cookie": auth.clearedCookie() });
  }
  if (route === "GET /api/posts") {
    const authenticated = Boolean(auth.getSession(req));
    if (query.has("page")) {
      const visible = store.listPosts().filter((post) => !post.pending_delete);
      const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, parseInt(query.get("page"), 10) || 1));
      const posts = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      return sendJson(res, 200, { posts: posts.map((post) => viewPost(post, authenticated)), page, pages });
    }
    const posts = store.listPosts().filter((post) => authenticated || !post.pending_delete);
    return sendJson(res, 200, posts.map((post) => viewPost(post, authenticated)));
  }
  if (route === "POST /api/posts/verify") {
    requireSession(req);
    const unverified = await verifyShares();
    return sendJson(res, 200, { posts: store.listPosts().map((post) => viewPost(post, true)), unverified });
  }
  if (route === "POST /api/posts") {
    requireSession(req);
    const input = await readJson(req);
    const networks = Array.isArray(input?.share) ? input.share.filter(share.isAvailable) : [];
    const post = store.createPost(input);
    if (Number.isInteger(input.draft_id)) store.deleteDraft(input.draft_id);
    removeUnused(store.usedBodies());
    return sendJson(res, 201, viewPost(await shareTo(req, post, [...new Set(networks)]), true));
  }
  if (route === "GET /api/profiles") {
    requireSession(req);
    return sendJson(res, 200, await share.profiles());
  }
  if (route === "POST /api/preview") {
    requireSession(req);
    const post = store.previewPost(await readJson(req));
    return sendJson(res, 200, share.preview(post, shareLink(req, post)));
  }
  if (route === "POST /api/test-share") {
    requireSession(req);
    const post = store.checkedPost(await readJson(req));
    const outcome = await share.sendTest(post, shareLink(req, post));
    if (!outcome.ok) throw httpError(502, outcome.error);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === "/api/autosave") {
    requireSession(req);
    const key = req.method === "POST" ? null : query.get("key");
    if (req.method === "GET") return sendJson(res, 200, { state: AUTOSAVE_KEY.test(key || "") ? store.getAutosave(key) : null });
    if (req.method === "DELETE") {
      if (AUTOSAVE_KEY.test(key || "")) store.deleteAutosave(key);
      return sendJson(res, 200, { deleted: true });
    }
    if (req.method === "POST") {
      const input = await readJson(req);
      if (!AUTOSAVE_KEY.test(input?.key || "")) throw httpError(400, "Invalid key");
      return sendJson(res, 200, store.setAutosave(input.key, input.state));
    }
  }
  if (route === "GET /api/drafts") {
    requireSession(req);
    return sendJson(res, 200, store.listDrafts());
  }
  if (route === "POST /api/drafts") {
    requireSession(req);
    return sendJson(res, 200, store.saveDraft(await readJson(req)));
  }
  if (pathname.startsWith("/api/drafts/") && (req.method === "GET" || req.method === "DELETE")) {
    requireSession(req);
    const id = Number(pathname.slice("/api/drafts/".length));
    if (req.method === "DELETE") {
      if (!store.deleteDraft(id)) throw httpError(404, "Draft not found");
      removeUnused(store.usedBodies());
      return sendJson(res, 200, { deleted: true });
    }
    const draft = store.getDraft(id);
    if (!draft) throw httpError(404, "Draft not found");
    return sendJson(res, 200, draft);
  }
  if (route === "GET /api/settings") {
    requireSession(req);
    return sendJson(res, 200, store.getSettings());
  }
  if (route === "POST /api/settings") {
    requireSession(req);
    return sendJson(res, 200, store.saveSettings(await readJson(req)));
  }
  if (route === "POST /api/images") {
    requireSession(req);
    return handleImageUpload(req, res);
  }
  if (req.method === "POST" && pathname.startsWith("/api/posts/") && pathname.endsWith("/share")) {
    requireSession(req);
    const post = store.getPost(pathname.slice("/api/posts/".length, -"/share".length));
    if (!post) throw httpError(404, "Post not found");
    const { network } = await readJson(req);
    if (!share.isAvailable(network)) throw httpError(400, "This network is not configured");
    if (share.isLive(post.shares?.[network])) throw httpError(409, "Already shared");
    return sendJson(res, 200, viewPost(await shareTo(req, post, [network]), true));
  }
  if (req.method === "POST" && pathname.startsWith("/api/posts/") && pathname.endsWith("/unshare")) {
    requireSession(req);
    const post = store.getPost(pathname.slice("/api/posts/".length, -"/unshare".length));
    if (!post) throw httpError(404, "Post not found");
    const { network } = await readJson(req);
    const shared = post.shares?.[network];
    if (!share.isLive(shared)) throw httpError(409, "The post is not there");
    const outcome = await share.removeShare(network, shared);
    if (!outcome.ok) throw httpError(502, outcome.error);
    return sendJson(res, 200, viewPost(store.setShare(post.id, network, { ...shared, deleted: true }), true));
  }
  if (req.method === "PUT" && pathname.startsWith("/api/posts/")) {
    requireSession(req);
    const input = await readJson(req);
    const post = store.updatePost(pathname.slice("/api/posts/".length), input);
    if (!post) throw httpError(404, "Post not found");
    if (Number.isInteger(input.draft_id)) store.deleteDraft(input.draft_id);
    removeUnused(store.usedBodies());
    const updates = {};
    for (const network of Array.isArray(input.update) ? [...new Set(input.update)] : []) {
      const shared = post.shares?.[network];
      if (share.isLive(shared)) updates[network] = await share.updateShare(network, post, shared, shareLink(req, post));
    }
    return sendJson(res, 200, { ...viewPost(post, true), updates });
  }
  if (req.method === "DELETE" && pathname.startsWith("/api/posts/")) {
    requireSession(req);
    return deletePost(req, res, pathname.slice("/api/posts/".length));
  }
  if (req.method === "GET" && pathname.startsWith("/api/posts/")) {
    const authenticated = Boolean(auth.getSession(req));
    const post = store.getPost(pathname.slice("/api/posts/".length));
    if (!post || (post.pending_delete && !authenticated)) throw httpError(404, "Post not found");
    return sendJson(res, 200, viewPost(post, authenticated));
  }
  throw httpError(404, "Not found");
}

function servePostPage(req, res, slug) {
  let html = fs.readFileSync(path.join(FRONTEND_DIR, "post.html"), "utf8");
  const post = slug ? store.getPost(slug) : null;
  if (post && !post.pending_delete) {
    const title = post.title || post.excerpt.slice(0, 80);
    const image = firstImage(post.body);
    const meta = [
      ["og:type", "article"],
      ["og:title", title],
      ["og:description", post.excerpt],
      ["og:url", postLink(req, post)],
    ];
    if (image?.startsWith("/media/")) meta.push(["og:image", siteUrl(req) + image]);
    const tags = meta.map(([property, content]) => `  <meta property="${property}" content="${escapeHtml(content)}">`);
    tags.push(`  <meta name="description" content="${escapeHtml(post.excerpt)}">`);
    tags.push(`  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`);
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
      .replace("</head>", `${tags.join("\n")}\n</head>`);
  }
  const body = Buffer.from(html);
  res.writeHead(200, { "Content-Type": MIME_TYPES[".html"], "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
}

async function handle(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw httpError(400, "Bad request");
  }

  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname, url.searchParams);
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Method not allowed");

  if (ADMIN_PAGES.has(pathname) && !auth.getSession(req)) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }
  if (pathname === "/post") return servePostPage(req, res, url.searchParams.get("slug"));
  if (PAGES.has(pathname)) return serveFile(req, res, FRONTEND_DIR, PAGES.get(pathname));
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return serveFile(req, res, FRONTEND_DIR, pathname);
  if (pathname.startsWith("/media/")) return serveFile(req, res, MEDIA_DIR, pathname.slice("/media".length));
  throw httpError(404, "Not found");
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:");
  res.setHeader("X-Content-Type-Options", "nosniff");
  handle(req, res).catch((error) => {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    if (res.headersSent) return res.end();
    sendJson(res, status, { detail: status === 500 ? "Server error" : error.message });
  });
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  if (!auth.hasCredentials()) console.log("No admin account yet. Run: npm run set-password");
  console.log(`Sharing to: ${share.available().join(", ") || "nothing configured"}`);
});

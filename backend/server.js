const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("./auth");
const store = require("./store");

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const MEDIA_DIR = path.join(__dirname, "media");
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PAGES = new Map([
  ["/", "index.html"],
  ["/post", "post.html"],
  ["/login", "login.html"],
  ["/new", "new.html"],
]);

const STATIC_PREFIXES = ["/css/", "/js/"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const IMAGE_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function httpError(status, detail) {
  return Object.assign(new Error(detail), { status });
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
  const name = crypto.randomBytes(16).toString("hex") + IMAGE_EXTENSIONS[actual];
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  sendJson(res, 201, { url: `/media/${name}` });
}

async function handleApi(req, res, pathname) {
  const route = `${req.method} ${pathname}`;
  if (req.method === "POST") requireSameOrigin(req);

  if (route === "GET /api/session") {
    return sendJson(res, 200, { authenticated: Boolean(auth.getSession(req)) });
  }
  if (route === "POST /api/login") {
    return handleLogin(req, res);
  }
  if (route === "POST /api/logout") {
    auth.logout(req);
    return sendJson(res, 200, { authenticated: false }, { "Set-Cookie": auth.clearedCookie() });
  }
  if (route === "GET /api/posts") {
    return sendJson(res, 200, store.listPosts());
  }
  if (route === "POST /api/posts") {
    requireSession(req);
    return sendJson(res, 201, store.createPost(await readJson(req)));
  }
  if (route === "POST /api/images") {
    requireSession(req);
    return handleImageUpload(req, res);
  }
  if (req.method === "GET" && pathname.startsWith("/api/posts/")) {
    const post = store.getPost(pathname.slice("/api/posts/".length));
    if (!post) throw httpError(404, "Post not found");
    return sendJson(res, 200, post);
  }
  throw httpError(404, "Not found");
}

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    throw httpError(400, "Bad request");
  }

  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Method not allowed");

  if (pathname === "/new" && !auth.getSession(req)) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }
  if (PAGES.has(pathname)) return serveFile(req, res, FRONTEND_DIR, PAGES.get(pathname));
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return serveFile(req, res, FRONTEND_DIR, pathname);
  if (pathname.startsWith("/media/")) return serveFile(req, res, MEDIA_DIR, pathname.slice("/media".length));
  throw httpError(404, "Not found");
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self'");
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
});

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ADMIN_FILE = path.join(__dirname, "data", "admin.json");
const COOKIE_NAME = "sid";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const sessions = new Map();
const failures = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest();
}

function createCredentials(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { username, salt, hash: hashPassword(password, salt).toString("hex") };
}

function saveCredentials(credentials) {
  fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(credentials, null, 2));
}

function readCredentials() {
  try {
    return JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function hasCredentials() {
  return readCredentials() !== null;
}

function verify(username, password) {
  const admin = readCredentials();
  if (!admin) return false;
  const expected = Buffer.from(admin.hash, "hex");
  const actual = hashPassword(password, admin.salt);
  const passwordOk = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  const usernameOk = crypto.timingSafeEqual(sha256(username), sha256(admin.username));
  return passwordOk && usernameOk;
}

function lockedSeconds(ip) {
  const entry = failures.get(ip);
  if (!entry || entry.until <= Date.now()) return 0;
  return Math.ceil((entry.until - Date.now()) / 1000);
}

function recordFailure(ip) {
  const entry = failures.get(ip) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.count = 0;
    entry.until = Date.now() + LOCKOUT_MS;
  }
  failures.set(ip, entry);
}

function login(ip, username, password) {
  const locked = lockedSeconds(ip);
  if (locked) return { ok: false, lockedSeconds: locked };
  if (!verify(username, password)) {
    recordFailure(ip);
    return { ok: false, lockedSeconds: lockedSeconds(ip) };
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_SECONDS * 1000);
  return { ok: true, token };
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const expires = sessions.get(token);
  if (!expires) return null;
  if (expires <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function logout(req) {
  const token = getSession(req);
  if (token) sessions.delete(token);
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function clearedCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = {
  createCredentials,
  saveCredentials,
  hasCredentials,
  login,
  logout,
  getSession,
  sessionCookie,
  clearedCookie,
};

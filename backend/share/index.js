const telegram = require("./telegram");
const linkedin = require("./linkedin");

const NETWORKS = { telegram, linkedin };

function available() {
  return Object.keys(NETWORKS).filter((name) => NETWORKS[name].isConfigured());
}

function isAvailable(name) {
  return Object.hasOwn(NETWORKS, name) && NETWORKS[name].isConfigured();
}

function testTargets() {
  return telegram.canTest() ? ["telegram"] : [];
}

async function sharePost(post, name, link) {
  const at = new Date().toISOString();
  try {
    return { ok: true, at, ...(await NETWORKS[name].share(post, link)) };
  } catch (error) {
    return { ok: false, at, error: error.message };
  }
}

function isLive(result) {
  return Boolean(result?.ok && !result.deleted);
}

function links(post) {
  const result = {};
  for (const name of Object.keys(NETWORKS)) {
    const shared = post.shares?.[name];
    result[name] = isLive(shared) ? NETWORKS[name].postUrl(shared) : null;
  }
  return result;
}

async function attempt(action) {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function removeShare(name, result) {
  if (!isAvailable(name)) return { ok: false, error: `${name} is not configured in .env` };
  return attempt(() => NETWORKS[name].remove(result));
}

function updateShare(name, post, result, link) {
  if (!isAvailable(name)) return { ok: false, error: `${name} is not configured in .env` };
  return attempt(() => NETWORKS[name].update(post, result, link));
}

function sendTest(post, link) {
  if (!telegram.canTest()) return { ok: false, error: "TELEGRAM_TEST_CHAT_ID is not set in .env" };
  return attempt(() => telegram.sendTest(post, link));
}

function preview(post, link) {
  const result = {};
  for (const [name, network] of Object.entries(NETWORKS)) {
    try {
      result[name] = network.preview(post, link);
    } catch (error) {
      result[name] = { error: error.message };
    }
  }
  return result;
}

async function profiles() {
  const result = {};
  for (const name of available()) {
    try {
      result[name] = await NETWORKS[name].profile();
    } catch {
      result[name] = { name: null };
    }
  }
  return result;
}

async function checkShare(name, result) {
  if (!isAvailable(name)) return { state: "unknown", reason: `${name} is not configured in .env` };
  try {
    return { state: (await NETWORKS[name].exists(result)) ? "exists" : "gone" };
  } catch (error) {
    return { state: "unknown", reason: error.message };
  }
}

module.exports = {
  available,
  isAvailable,
  testTargets,
  sharePost,
  isLive,
  links,
  removeShare,
  updateShare,
  sendTest,
  preview,
  profiles,
  checkShare,
};

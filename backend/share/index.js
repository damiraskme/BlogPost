const telegram = require("./telegram");
const linkedin = require("./linkedin");

const NETWORKS = { telegram, linkedin };

function available() {
  return Object.keys(NETWORKS).filter((name) => NETWORKS[name].isConfigured());
}

function isAvailable(name) {
  return Object.hasOwn(NETWORKS, name) && NETWORKS[name].isConfigured();
}

async function sharePost(post, name, link) {
  const network = NETWORKS[name];
  const at = new Date().toISOString();
  try {
    const result = post.type === "short" ? await network.shareShort(post, link) : await network.shareArticle(post, link);
    return { ok: true, at, ...result };
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

async function removeShare(name, result) {
  if (!isAvailable(name)) return { ok: false, error: `${name} is not configured in .env` };
  try {
    await NETWORKS[name].remove(result);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkShare(name, result) {
  if (!isAvailable(name)) return { state: "unknown", reason: `${name} is not configured in .env` };
  try {
    return { state: (await NETWORKS[name].exists(result)) ? "exists" : "gone" };
  } catch (error) {
    return { state: "unknown", reason: error.message };
  }
}

module.exports = { available, isAvailable, sharePost, isLive, links, removeShare, checkShare };

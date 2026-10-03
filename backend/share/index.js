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

module.exports = { available, isAvailable, sharePost };

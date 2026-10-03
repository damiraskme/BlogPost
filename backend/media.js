const fs = require("fs");
const path = require("path");

const MEDIA_DIR = path.join(__dirname, "media");
const MEDIA_NAME = /^[0-9a-f]{32}\.(?:png|jpg|webp)$/;
const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function readLocalImage(src) {
  const match = /^\/media\/([0-9a-f]{32}\.(?:png|jpg|webp))$/.exec(src);
  if (!match) return null;
  try {
    const buffer = fs.readFileSync(path.join(MEDIA_DIR, match[1]));
    return { name: match[1], type: MEDIA_TYPES[path.extname(match[1])], buffer };
  } catch {
    return null;
  }
}

function removeUnused(bodies) {
  const used = new Set();
  for (const body of bodies) {
    for (const match of body.matchAll(/\/media\/([0-9a-f]{32}\.(?:png|jpg|webp))/g)) used.add(match[1]);
  }
  let names;
  try {
    names = fs.readdirSync(MEDIA_DIR);
  } catch {
    return 0;
  }
  const unused = names.filter((name) => MEDIA_NAME.test(name) && !used.has(name));
  for (const name of unused) fs.rmSync(path.join(MEDIA_DIR, name), { force: true });
  return unused.length;
}

module.exports = { MEDIA_DIR, readLocalImage, removeUnused };

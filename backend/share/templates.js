const fs = require("fs");
const path = require("path");
const { parseBody } = require("./content");

const TEMPLATES_FILE = path.join(__dirname, "..", "templates.json");

function loadTemplates() {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf8"));
  } catch (error) {
    throw new Error(`templates.json: ${error.code === "ENOENT" ? "file not found" : error.message}`);
  }
}

function getTemplate(network, type) {
  const templates = loadTemplates();
  const template = templates[network]?.[type];
  if (!template) throw new Error(`templates.json has no ${network}.${type} template`);
  return { locale: templates.locale, ...(typeof template === "string" ? { text: template } : template) };
}

function templateValues(post, network, locale, link, url) {
  const body = parseBody(post.overrides?.[network] || post.body);
  return {
    title: post.title,
    body: { text: body.text, entities: body.entities },
    excerpt: post.excerpt,
    date: new Date(post.created_at).toLocaleDateString(locale || "en-US", { year: "numeric", month: "long", day: "numeric" }),
    link: link || "",
    url: url || "",
  };
}

module.exports = { getTemplate, templateValues };

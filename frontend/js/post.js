import { getPost, getSession, sharePost, editUrl, formatDate, NETWORK_NAMES } from "./api.js";
import { shareLinks } from "./links.js";

const container = document.getElementById("post");
const status = document.getElementById("status");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function shareLine(post, network, onUpdate) {
  const result = post.shares?.[network];
  const name = NETWORK_NAMES[network] || network;
  const line = element("p");
  if (result?.ok && !result.deleted) {
    line.textContent = `${name}: shared${result.note ? ` (${result.note})` : ""}`;
    return line;
  }
  const failed = result && !result.ok;
  line.textContent = failed ? `${name}: failed, ${result.error} ` : `${name}: not shared `;
  const button = element("button", failed ? "Retry" : "Share");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      onUpdate(await sharePost(post.slug, network));
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
  line.append(button);
  return line;
}

function renderHead(head, post) {
  const parts = [];
  if (post.title) parts.push(element("h1", post.title));
  parts.push(element("span", formatDate(post.created_at), "date"), shareLinks(post));
  head.replaceChildren(...parts);
}

function renderShares(target, head, post, networks) {
  renderHead(head, post);
  target.replaceChildren(
    ...networks.map((network) => shareLine(post, network, (updated) => renderShares(target, head, updated, networks))),
  );
}

async function load() {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) throw new Error("Post not found");
  const [post, session] = await Promise.all([getPost(slug), getSession()]);
  if (post.title) document.title = post.title;

  const article = element("article", undefined, "post");
  const head = element("div", undefined, "post-head");
  renderHead(head, post);
  const body = element("div", undefined, "post-body");
  body.innerHTML = post.body;
  article.append(head, body);

  if (session.authenticated) {
    const controls = element("p");
    const edit = element("button", "Edit");
    edit.addEventListener("click", () => {
      location.href = editUrl(post.slug);
    });
    controls.append(edit);
    const shares = element("div");
    renderShares(shares, head, post, session.networks);
    article.append(controls, shares);
  }
  container.append(article);
}

load().catch((error) => {
  status.textContent = error.message;
});

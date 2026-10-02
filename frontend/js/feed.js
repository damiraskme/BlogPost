import { listPosts, getSession, postUrl, formatDate } from "./api.js";

const list = document.getElementById("posts");
const status = document.getElementById("status");

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPost(post, authenticated) {
  const box = element("div");
  box.className = "box";

  if (post.title) {
    const heading = element("h2");
    const link = element("a", post.title);
    link.href = postUrl(post.slug);
    heading.append(link);
    box.append(heading);
  }

  if (post.type === "short") {
    const body = element("div");
    body.innerHTML = post.body;
    box.append(body);
  } else {
    box.append(element("p", post.excerpt));
    const more = element("a", "Read...");
    more.href = postUrl(post.slug);
    box.append(more);
  }

  box.append(element("p", formatDate(post.created_at)));
  if (authenticated) box.append(element("button", "Edit"));
  return box;
}

async function load() {
  const [posts, session] = await Promise.all([listPosts(), getSession()]);
  document.getElementById("admin").hidden = !session.authenticated;
  if (!posts.length) status.textContent = "No posts yet.";
  list.append(...posts.map((post) => renderPost(post, session.authenticated)));
}

load().catch((error) => {
  status.textContent = error.message;
});

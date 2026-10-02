import { getPost, getSession, formatDate } from "./api.js";

const container = document.getElementById("post");
const status = document.getElementById("status");

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load() {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) throw new Error("Post not found");
  const [post, session] = await Promise.all([getPost(slug), getSession()]);

  const box = element("div");
  box.className = "box";
  if (post.title) {
    document.title = post.title;
    box.append(element("h1", post.title));
  }
  box.append(element("p", formatDate(post.created_at)));
  const body = element("div");
  body.innerHTML = post.body;
  box.append(body);
  if (session.authenticated) box.append(element("button", "Edit"));
  container.append(box);
}

load().catch((error) => {
  status.textContent = error.message;
});

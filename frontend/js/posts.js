import { listPosts, verifyPosts, deletePost, logout, postUrl, editUrl, formatDate, NETWORK_NAMES } from "./api.js";
import { shareLinks } from "./links.js";

const list = document.getElementById("posts");
const status = document.getElementById("status");
const dialog = document.getElementById("delete-dialog");
const dialogText = document.getElementById("delete-text");
const dialogNetworks = document.getElementById("delete-networks");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function fail(error) {
  if (error.status === 401) location.href = "/login";
  else status.textContent = error.message;
}

function label(post) {
  return post.title || post.preview.slice(0, 60) || "untitled";
}

function failedNetworks(post) {
  return Object.keys(post.shares || {}).filter((network) => post.shares[network].delete_error);
}

function askDelete(post) {
  dialogText.textContent = `Delete "${label(post)}"? This cannot be undone.`;
  dialogNetworks.replaceChildren(
    ...Object.keys(NETWORK_NAMES).map((network) => {
      const line = element("p");
      const option = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.value = network;
      checkbox.checked = Boolean(post.links[network]);
      checkbox.disabled = !post.links[network];
      option.append(checkbox, ` Also delete from ${NETWORK_NAMES[network]}`);
      if (checkbox.disabled) option.className = "muted";
      line.append(option);
      return line;
    }),
  );
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue !== "confirm") return resolve(null);
        resolve([...dialogNetworks.querySelectorAll("input:checked")].map((input) => input.value));
      },
      { once: true },
    );
  });
}

async function runDelete(post, box, options, buttons) {
  for (const button of buttons) button.disabled = true;
  status.textContent = "";
  try {
    const result = await deletePost(post.slug, options);
    if (result.deleted) {
      box.remove();
      if (!list.children.length) status.textContent = "No posts yet.";
    } else {
      box.replaceWith(renderPost(result.post));
    }
  } catch (error) {
    fail(error);
    for (const button of buttons) button.disabled = false;
  }
}

function adminButtons(post, box) {
  const line = element("p");
  const edit = element("button", "Edit");
  edit.addEventListener("click", () => {
    location.href = editUrl(post.slug);
  });
  const remove = element("button", "Delete");
  remove.addEventListener("click", async () => {
    const networks = await askDelete(post);
    if (networks) runDelete(post, box, { networks }, [edit, remove]);
  });
  line.append(edit, " ", remove);
  return line;
}

function pendingControls(post, box) {
  const container = element("div");
  const failed = failedNetworks(post);
  for (const network of failed) {
    const error = post.shares[network].delete_error;
    container.append(element("p", `Not deleted from ${NETWORK_NAMES[network] || network}: ${error}`, "danger-text"));
  }
  container.append(element("p", "This post is hidden from visitors. Delete the remaining copies by hand, or retry."));
  const line = element("p");
  const retry = element("button", "Retry");
  const force = element("button", "Delete from site only", "danger");
  retry.addEventListener("click", () => runDelete(post, box, { networks: failed }, [retry, force]));
  force.addEventListener("click", () => runDelete(post, box, { force: true }, [retry, force]));
  line.append(retry, " ", force);
  container.append(line);
  return container;
}

function renderPost(post) {
  const box = element("div", undefined, post.pending_delete ? "box danger" : "box");
  const head = element("div", undefined, "post-head");
  const heading = element("h2");
  const link = element("a", label(post));
  link.href = postUrl(post.slug);
  heading.append(link);
  head.append(heading, element("span", `${formatDate(post.created_at)}, ${post.type}`, "date"), shareLinks(post));
  box.append(head, post.pending_delete ? pendingControls(post, box) : adminButtons(post, box));
  return box;
}

function showPosts(posts) {
  list.replaceChildren(...posts.map(renderPost));
}

async function load() {
  const posts = await listPosts();
  if (!posts.length) {
    status.textContent = "No posts yet.";
    return;
  }
  for (const post of posts) post.checking = true;
  showPosts(posts);
  status.textContent = "Checking which posts still exist on Telegram and LinkedIn...";
  const verified = await verifyPosts();
  showPosts(verified.posts);
  const notes = Object.values(verified.unverified);
  status.textContent = notes.length ? `Not checked: ${notes.join("; ")}` : "";
}

document.getElementById("logout").addEventListener("click", async () => {
  await logout().catch(() => null);
  location.href = "/blog";
});

load().catch(fail);

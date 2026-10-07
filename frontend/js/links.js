import { NETWORK_NAMES } from "./api.js";

const ORDER = ["telegram", "linkedin"];

export function shareLinks(post) {
  const group = document.createElement("span");
  group.className = "share-buttons";
  for (const network of ORDER) {
    const url = post.links?.[network];
    const node = document.createElement(url ? "a" : "span");
    node.textContent = NETWORK_NAMES[network];
    node.className = "share-button";
    if (url) {
      node.href = url;
      node.target = "_blank";
      node.rel = "noopener";
    }
    if (post.shares?.[network]?.delete_error) node.classList.add("danger-text");
    else if (post.checking && url) node.classList.add("checking");
    else if (!url) node.classList.add("muted");
    group.append(node);
  }
  return group;
}

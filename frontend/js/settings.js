import { getSession, getSettings, saveSettings, NETWORK_NAMES } from "./api.js";

const networks = document.getElementById("networks");
const hashtags = document.getElementById("hashtags");
const save = document.getElementById("save");
const status = document.getElementById("status");

function fail(error) {
  if (error.status === 401) location.href = "/login";
  else status.textContent = error.message;
}

function addSet(set) {
  const row = document.createElement("div");
  row.className = "hashtag-set";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Name";
  name.maxLength = 40;
  name.value = set?.name || "";
  const tags = document.createElement("input");
  tags.type = "text";
  tags.placeholder = "#tag1 #tag2";
  tags.maxLength = 300;
  tags.value = set?.tags || "";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());
  row.append(name, tags, remove);
  hashtags.append(row);
}

async function load() {
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  if (!session.networks.length) networks.textContent = "No networks are configured in backend/.env.";
  for (const network of session.networks) {
    const line = document.createElement("p");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = network;
    checkbox.checked = settings.share[network] ?? true;
    label.append(checkbox, ` ${NETWORK_NAMES[network] || network}`);
    line.append(label);
    networks.append(line);
  }
  document.querySelector(`input[name=default-type][value=${settings.default_type}]`).checked = true;
  for (const set of settings.hashtags) addSet(set);
}

document.getElementById("add-set").addEventListener("click", () => addSet(null));

save.addEventListener("click", async () => {
  const share = {};
  for (const checkbox of networks.querySelectorAll("input[type=checkbox]")) share[checkbox.value] = checkbox.checked;
  const sets = [...hashtags.querySelectorAll(".hashtag-set")].map((row) => {
    const [name, tags] = row.querySelectorAll("input");
    return { name: name.value, tags: tags.value };
  });
  try {
    await saveSettings({
      share,
      default_type: document.querySelector("input[name=default-type]:checked").value,
      hashtags: sets,
    });
    status.textContent = "Saved";
  } catch (error) {
    fail(error);
  }
});

load().catch(fail);

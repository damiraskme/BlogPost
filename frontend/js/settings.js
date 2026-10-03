import { getSession, getSettings, saveSettings, NETWORK_NAMES } from "./api.js";

const container = document.getElementById("networks");
const save = document.getElementById("save");
const status = document.getElementById("status");

function fail(error) {
  if (error.status === 401) location.href = "/login";
  else status.textContent = error.message;
}

async function load() {
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  if (!session.networks.length) {
    container.textContent = "No networks are configured in backend/.env.";
    save.hidden = true;
    return;
  }
  for (const network of session.networks) {
    const line = document.createElement("p");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = network;
    checkbox.checked = settings.share[network] ?? true;
    label.append(checkbox, ` ${NETWORK_NAMES[network] || network}`);
    line.append(label);
    container.append(line);
  }
}

save.addEventListener("click", async () => {
  const share = {};
  for (const checkbox of container.querySelectorAll("input[type=checkbox]")) share[checkbox.value] = checkbox.checked;
  try {
    await saveSettings({ share });
    status.textContent = "Saved";
  } catch (error) {
    fail(error);
  }
});

load().catch(fail);

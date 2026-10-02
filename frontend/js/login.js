import { login } from "./api.js";

const form = document.getElementById("login");
const status = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  try {
    await login(document.getElementById("username").value, document.getElementById("password").value);
    location.href = "/new";
  } catch (error) {
    status.textContent = error.message;
  }
});

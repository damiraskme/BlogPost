import { getSession } from "./api.js";

getSession()
  .then((session) => {
    document.getElementById("admin-nav").hidden = !session.authenticated;
  })
  .catch(() => null);

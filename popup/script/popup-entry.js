import { startApp } from "../../src/ui/app-controller.js";

void startApp({ surface: "popup" }).catch((error) => {
  const message = /** @type {HTMLElement|null} */ (document.querySelector("#app-message"));
  if (message) {
    message.textContent = error instanceof Error ? error.message : "cTool could not start.";
    message.classList.add("is-error");
    message.hidden = false;
  }
});

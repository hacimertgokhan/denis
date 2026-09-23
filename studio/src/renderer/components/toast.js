/**
 * Toast notifications. Errors show their code (e.g. SQL, AUTH, FORBIDDEN)
 * and stay until dismissed; other toasts fade after a few seconds.
 * The container is an aria-live region so screen readers announce them.
 */
import { h } from "../util/dom.js";
import { icon } from "./icons.js";

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.getElementById("toasts");
  }
  return container;
}

/**
 * @param {string} message
 * @param {{kind?: "info"|"success"|"error"|"warning", code?: string, title?: string, timeout?: number}} [o]
 */
export function toast(message, o = {}) {
  const kind = o.kind || "info";
  const root = ensureContainer();
  if (!root) return;
  const close = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  const el = h(
    "div",
    { class: ["toast", `toast-${kind}`], role: kind === "error" ? "alert" : "status" },
    h("span", { class: "toast-icon" }, icon(kind === "success" ? "check" : kind === "error" || kind === "warning" ? "alert" : "info")),
    h(
      "div",
      { class: "toast-body" },
      o.title || o.code ? h("div", { class: "toast-title" }, o.title || "", o.code ? h("span", { class: "code-badge" }, o.code) : null) : null,
      h("div", { class: "toast-message" }, message),
    ),
    h("button", { class: "icon-btn toast-close", type: "button", "aria-label": "Dismiss notification", onclick: close }, icon("x", { size: 14 })),
  );
  root.append(el);
  // keep the stack short
  while (root.children.length > 5) root.firstElementChild.remove();
  const timeout = o.timeout ?? (kind === "error" ? 9000 : 3500);
  if (timeout > 0) setTimeout(close, timeout);
}

/** Show an error from the API (ApiError has .code). */
export function toastError(err, title) {
  const code = err && err.code && err.code !== "ERROR" ? err.code : undefined;
  toast((err && err.message) || String(err), { kind: "error", code, title: title || "Error" });
}

export const toastSuccess = (message, title) => toast(message, { kind: "success", title });

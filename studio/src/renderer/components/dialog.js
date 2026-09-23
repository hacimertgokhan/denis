/**
 * Modal dialogs built on <dialog>.showModal(): the browser traps focus,
 * Escape cancels, and focus returns to the opener when the dialog closes.
 */
import { h, uid } from "../util/dom.js";
import { store } from "../store.js";

/**
 * Generic modal. `build(close)` returns the body; `actions` are buttons.
 * Resolves with the value passed to close(value) (undefined on Escape).
 * @param {{title: string, body: Node|Node[], actions?: {label: string, value?: any, kind?: string, autofocus?: boolean, onClick?: Function}[], wide?: boolean, onSubmit?: (close: Function) => any, initialFocus?: HTMLElement}} o
 */
export function modal(o) {
  return new Promise((resolve) => {
    const titleId = uid("dlg-title");
    const opener = document.activeElement;
    let result;
    const dlg = h("dialog", { class: ["modal", o.wide ? "modal-wide" : null], "aria-labelledby": titleId });
    const close = (value) => {
      result = value;
      if (dlg.open) dlg.close();
    };
    const form = h("form", { method: "dialog", class: "modal-form", novalidate: true });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (o.onSubmit) o.onSubmit(close);
      else close(true);
    });
    const buttons = (o.actions || [{ label: "OK", value: true, kind: "primary" }]).map((a) =>
      h(
        "button",
        {
          type: a.submit ? "submit" : "button",
          class: ["btn", a.kind ? `btn-${a.kind}` : null],
          onclick: a.submit
            ? undefined
            : () => {
                if (a.onClick) a.onClick(close);
                else close(a.value);
              },
        },
        a.label,
      ),
    );
    form.append(
      h("header", { class: "modal-header" }, h("h2", { id: titleId }, o.title)),
      h("div", { class: "modal-body" }, o.body),
      h("footer", { class: "modal-actions" }, buttons),
    );
    dlg.append(form);
    dlg.addEventListener("close", () => {
      dlg.remove();
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    const focusTarget = o.initialFocus || dlg.querySelector("[autofocus]") || dlg.querySelector("input, textarea, select") || buttons[buttons.length - 1];
    if (focusTarget) focusTarget.focus();
  });
}

/**
 * Yes/No confirmation. With settings.confirmDestructive off, resolves true
 * immediately unless `force` (typed confirmations are always asked).
 */
export async function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, force = false }) {
  if (!force && !store.get().settings.confirmDestructive) return true;
  const result = await modal({
    title,
    body: h("p", { class: "modal-message" }, message),
    actions: [
      { label: "Cancel", value: false },
      { label: confirmLabel, value: true, kind: danger ? "danger" : "primary" },
    ],
  });
  return result === true;
}

/**
 * Confirmation that requires typing a word (e.g. the project token prefix).
 * Always asked, regardless of the settings toggle.
 */
export async function typedConfirm({ title, message, expected, confirmLabel = "Delete" }) {
  const inputId = uid("typed");
  const input = h("input", { id: inputId, type: "text", class: "input mono", autocomplete: "off", spellcheck: "false" });
  const button = h("button", { type: "submit", class: "btn btn-danger", disabled: true }, confirmLabel);
  input.addEventListener("input", () => {
    button.disabled = input.value.trim() !== expected;
  });
  return new Promise((resolve) => {
    const titleId = uid("dlg-title");
    const opener = document.activeElement;
    let ok = false;
    const dlg = h("dialog", { class: "modal", "aria-labelledby": titleId });
    const form = h(
      "form",
      { class: "modal-form" },
      h("header", { class: "modal-header" }, h("h2", { id: titleId }, title)),
      h(
        "div",
        { class: "modal-body" },
        h("p", { class: "modal-message" }, message),
        h("label", { for: inputId, class: "typed-label" }, "Type ", h("code", {}, expected), " to confirm:"),
        input,
      ),
      h("footer", { class: "modal-actions" }, h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancel"), button),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value.trim() === expected) {
        ok = true;
        dlg.close();
      }
    });
    dlg.append(form);
    dlg.addEventListener("close", () => {
      dlg.remove();
      if (opener && document.contains(opener)) opener.focus();
      resolve(ok);
    });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}

/**
 * Ask for one value (e.g. a password).
 * @returns {Promise<string|null>}
 */
export async function promptDialog({ title, message, label, type = "text", value = "", confirmLabel = "OK", validate }) {
  const inputId = uid("prompt");
  const input = h("input", { id: inputId, type, class: "input", value, autocomplete: type === "password" ? "current-password" : "off", spellcheck: "false" });
  const error = h("div", { class: "field-error", role: "alert" });
  let result = null;
  await modal({
    title,
    body: [message ? h("p", { class: "modal-message" }, message) : null, h("div", { class: "field" }, h("label", { for: inputId }, label), input, error)].filter(Boolean),
    actions: [
      { label: "Cancel", value: null },
      { label: confirmLabel, kind: "primary", submit: true },
    ],
    initialFocus: input,
    onSubmit: (close) => {
      const problem = validate ? validate(input.value) : null;
      if (problem) {
        error.textContent = problem;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      result = input.value;
      close(true);
    },
  });
  return result;
}

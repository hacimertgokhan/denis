/**
 * Minimal DOM builder. Text is always set with textContent (never innerHTML),
 * so server data can never inject markup.
 *
 *   h("button", { class: "btn", onclick: fn, "aria-label": "Close" }, "×")
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function applyProps(el, props) {
  for (const [name, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class" || name === "className") {
      el.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : value);
    } else if (name === "dataset") {
      Object.assign(el.dataset, value);
    } else if (name === "style") {
      // CSSOM only (allowed by the CSP, unlike style="" attributes)
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith("--")) el.style.setProperty(k, v);
        else el.style[k] = v;
      }
    } else if (name.startsWith("on") && typeof value === "function") {
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === "value" && "value" in el) {
      el.value = value;
    } else if (name === "checked" || name === "disabled" || name === "selected" || name === "hidden" || name === "open" || name === "multiple" || name === "readOnly" || name === "required") {
      el[name] = !!value;
    } else if (value === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(value));
    }
  }
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
  } else {
    applyProps(el, props);
  }
  appendChildren(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  for (const child of children.flat()) if (child) el.append(child);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  appendChildren(el, children);
  return el;
}

let idCounter = 0;
export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Labelled form field: returns {wrap, input}. */
export function field(labelText, input, hint) {
  const id = input.id || uid("f");
  input.id = id;
  const hintEl = hint ? h("div", { class: "hint", id: `${id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute("aria-describedby", hintEl.id);
  const wrap = h("div", { class: "field" }, h("label", { for: id }, labelText), input, hintEl);
  return { wrap, input, hint: hintEl };
}

/** Debounce a function (for search boxes). */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Run an async action while a button shows a busy state. */
export async function busy(button, fn) {
  const buttons = Array.isArray(button) ? button : [button];
  for (const b of buttons) {
    if (!b) continue;
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
  }
  try {
    return await fn();
  } finally {
    for (const b of buttons) {
      if (!b) continue;
      b.disabled = false;
      b.removeAttribute("aria-busy");
    }
  }
}

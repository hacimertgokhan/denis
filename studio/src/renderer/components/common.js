/**
 * Small shared UI pieces: page header, cards, badges, empty states.
 */
import { h } from "../util/dom.js";
import { icon } from "./icons.js";

export function pageHeader(title, subtitle, ...actions) {
  return h(
    "header",
    { class: "page-header" },
    h("div", { class: "page-titles" }, h("h1", { tabindex: "-1", class: "page-title" }, title), subtitle ? h("p", { class: "page-subtitle" }, subtitle) : null),
    h("div", { class: "page-actions" }, ...actions),
  );
}

export function card(title, ...children) {
  return h("section", { class: "card", "aria-label": typeof title === "string" ? title : undefined }, title ? h("h2", { class: "card-title" }, title) : null, ...children);
}

export function badge(text, kind = "neutral", title) {
  return h("span", { class: ["badge", `badge-${kind}`], title }, text);
}

export function iconButton(name, label, onclick, extra = {}) {
  return h("button", { type: "button", class: ["icon-btn", extra.class], "aria-label": label, title: label, onclick, ...extra.attrs }, icon(name, { size: 16 }));
}

export function button(label, onclick, { kind, iconName, small, type = "button", title, disabled } = {}) {
  return h(
    "button",
    { type, class: ["btn", kind ? `btn-${kind}` : null, small ? "btn-small" : null], onclick, title, disabled },
    iconName ? icon(iconName, { size: small ? 14 : 16 }) : null,
    label,
  );
}

export function emptyState(title, message, ...actions) {
  return h("div", { class: "empty-state" }, h("h2", {}, title), message ? h("p", {}, message) : null, actions.length ? h("div", { class: "empty-actions" }, ...actions) : null);
}

/** Label/value list for stats. */
export function statList(items) {
  return h(
    "dl",
    { class: "stat-list" },
    ...items.flatMap(([label, value]) => [h("dt", {}, label), h("dd", {}, value === undefined || value === null ? "–" : value)]),
  );
}

export function layerBadges(meta) {
  const out = [];
  if (meta.cache) out.push(badge("cache", "cache", "Value in memory (cache layer)"));
  if (meta.persistent) out.push(badge("durable", "durable", "Durable value (written to the log, survives restarts)"));
  if (!meta.cache && !meta.persistent) out.push(badge("gone", "muted", "Key no longer exists"));
  return out;
}

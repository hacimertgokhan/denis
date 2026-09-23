/**
 * Renderer entry: navigation, view mounting, status bar, theme, shortcuts.
 *
 * Views are modules exporting {id, title, icon, needs, mount(root, ctx)}.
 * `needs` is null, "connection" or "project"; when unmet, a helpful empty
 * state is shown instead of the view. mount() returns an object with an
 * optional unmount(), refresh() and onStatus(status, prev).
 */
import { api, bridgeAvailable } from "./api.js";
import { store } from "./store.js";
import { h, clear, replace } from "./util/dom.js";
import { icon } from "./components/icons.js";
import { toast, toastError } from "./components/toast.js";
import { modal } from "./components/dialog.js";
import { badge, emptyState, button } from "./components/common.js";
import { formatMs, shortToken } from "./util/format.js";

import connections from "./views/connections.js";
import dashboard from "./views/dashboard.js";
import projects from "./views/projects.js";
import keys from "./views/keys.js";
import sql from "./views/sql.js";
import backup from "./views/backup.js";
import consoleView from "./views/console.js";
import settings from "./views/settings.js";

const VIEWS = [connections, dashboard, projects, keys, sql, backup, consoleView, settings];
const byId = new Map(VIEWS.map((v) => [v.id, v]));

const SHORTCUTS = [
  ["Ctrl/Cmd + 1 … 8", "Switch view (Connections … Settings)"],
  ["F5", "Refresh the current view"],
  ["Ctrl/Cmd + Shift + N", "New window (one connection per window)"],
  ["Ctrl/Cmd + ,", "Settings"],
  ["Ctrl/Cmd + Enter", "Run SQL (SQL view) / save value (Keys view)"],
  ["Ctrl/Cmd + Shift + E", "Explain the SQL statement"],
  ["Ctrl/Cmd + K", "Focus the key search (Keys view)"],
  ["Ctrl/Cmd + N", "New key (Keys view)"],
  ["Up / Down", "Command history (Console view)"],
  ["Arrow keys, Ctrl/Cmd + C", "Move in result grid, copy cell (Shift: row)"],
  ["F1", "This list"],
];

let current = null; // {view, instance, key}
const viewRoot = document.getElementById("view");
const navList = document.getElementById("nav");
const statusbar = document.getElementById("statusbar");

// ------------------------------------------------------------------ theme

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" || theme === "dark" ? theme : "system";
}

// ------------------------------------------------------------------ navigation

function buildNav() {
  VIEWS.forEach((view, i) => {
    const btn = h(
      "button",
      { type: "button", class: "nav-item", dataset: { view: view.id }, title: `${view.title} (Ctrl+${i + 1})`, onclick: () => navigate(view.id) },
      icon(view.icon, { size: 18 }),
      h("span", { class: "nav-label" }, view.title),
    );
    navList.append(h("li", {}, btn));
  });
  // arrow keys move between nav items
  navList.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...navList.querySelectorAll(".nav-item")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
  });
}

function gateOf(view, s) {
  const st = s.status.state;
  const live = st === "connected" || st === "reconnecting";
  if ((view.needs === "connection" || view.needs === "project") && !live) return "connection";
  if (view.needs === "project" && !s.status.project) return "project";
  return null;
}

/** Remount when the view, its gate or the session identity changes (not on latency/reconnect). */
function mountKey(view, s) {
  const gate = gateOf(view, s);
  if (gate || !view.needs) return `${view.id}|${gate || ""}`;
  const st = s.status;
  return `${view.id}|${st.host}:${st.port}|${st.group}|${view.needs === "project" ? st.project : ""}|${st.profileId || ""}`;
}

function renderGate(view, gate) {
  if (gate === "connection") {
    return emptyState(
      `${view.title} needs a connection`,
      "Connect to a Denis server first.",
      button("Go to Connections", () => navigate("connections"), { kind: "primary", iconName: "plug" }),
    );
  }
  return emptyState(
    `${view.title} needs a project`,
    "Keys, SQL and exports belong to a project. Choose or create one on the Projects page.",
    button("Go to Projects", () => navigate("projects"), { kind: "primary", iconName: "folder" }),
  );
}

function unmountCurrent() {
  if (current && current.instance && typeof current.instance.unmount === "function") {
    try {
      current.instance.unmount();
    } catch (err) {
      console.error(err);
    }
  }
}

function mount(view, { focus = true } = {}) {
  const s = store.get();
  unmountCurrent();
  clear(viewRoot);
  const gate = gateOf(view, s);
  let instance = null;
  if (gate) {
    viewRoot.append(renderGate(view, gate));
  } else {
    const root = h("div", { class: ["view-inner", `view-${view.id}`] });
    viewRoot.append(root);
    try {
      instance = view.mount(root, ctx) || null;
    } catch (err) {
      console.error(err);
      toastError(err, `Could not open ${view.title}`);
    }
  }
  current = { view, instance, key: mountKey(view, s) };
  for (const b of navList.querySelectorAll(".nav-item")) {
    if (b.dataset.view === view.id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  document.title = `${view.title} · Denis Studio`;
  if (focus) {
    const title = viewRoot.querySelector(".page-title, h1, h2");
    (title || viewRoot).focus({ preventScroll: true });
  }
}

export function navigate(id) {
  const view = byId.get(id);
  if (!view) return;
  mount(view);
}

const ctx = {
  api,
  store,
  navigate: (id) => navigate(id),
};

// ------------------------------------------------------------------ status bar

function renderStatus(s) {
  const st = s.status;
  const state = st.state || "disconnected";
  const labels = {
    connected: "Connected",
    connecting: "Connecting…",
    reconnecting: `Reconnecting${st.attempt ? ` (attempt ${st.attempt})` : ""}…`,
    disconnected: "Not connected",
    error: "Connection failed",
  };
  const items = [h("span", { class: ["status-dot", `dot-${state}`], "aria-hidden": "true" }), h("span", { class: "status-state" }, labels[state] || state)];
  if (state !== "disconnected" && st.host) {
    items.push(h("span", { class: "status-sep" }), h("span", { title: st.name || "" }, `${st.host}:${st.port}`));
    if (st.group) items.push(h("span", { class: "status-sep" }), h("span", {}, "group ", h("strong", {}, st.group)));
    if (st.admin) items.push(badge("admin", "admin", "This group has admin rights"));
    items.push(h("span", { class: "status-sep" }), h("span", { title: st.project || "No project selected" }, "project ", h("span", { class: "mono" }, st.project ? shortToken(st.project) : "none")));
  }
  if (state === "error" && st.error) items.push(h("span", { class: "status-error" }, `${st.error.code || ""} ${st.error.message || ""}`.trim()));
  if (state === "reconnecting" && st.error) items.push(h("span", { class: "status-error" }, st.error.message));
  const right = [];
  if (state === "connected" || state === "reconnecting") {
    if (st.latencyMs !== null && st.latencyMs !== undefined) right.push(h("span", { title: "Latency of the last command" }, icon("clock", { size: 13 }), " ", formatMs(st.latencyMs)));
    if (st.version) right.push(h("span", { title: `Protocol ${st.protocol ?? "?"}` }, `Denis ${st.version}`));
  }
  replace(statusbar, h("div", { class: "status-left" }, items), h("div", { class: "status-right" }, right));
  statusbar.dataset.state = state;
}

// ------------------------------------------------------------------ store reactions

function onStoreChange(s, prev) {
  if (s.status !== prev.status) {
    renderStatus(s);
    const from = prev.status.state;
    const to = s.status.state;
    if (from === "connected" && to === "reconnecting") toast("Connection lost. Reconnecting in the background…", { kind: "warning", title: "Server unreachable" });
    if (from === "reconnecting" && to === "connected") toast("Connection restored.", { kind: "success" });
    if (from === "reconnecting" && to === "error") toastError({ message: s.status.error?.message || "Reconnect failed", code: s.status.error?.code }, "Reconnect failed");
  }
  if (s.settings !== prev.settings) applyTheme(s.settings.theme);
  if (current) {
    const key = mountKey(current.view, s);
    if (key !== current.key) {
      mount(current.view, { focus: false });
    } else if (s.status !== prev.status && current.instance && typeof current.instance.onStatus === "function") {
      current.instance.onStatus(s.status, prev.status);
    }
  }
}

// ------------------------------------------------------------------ shortcuts & menu

function showShortcuts() {
  modal({
    title: "Keyboard shortcuts",
    wide: true,
    body: h("table", { class: "shortcut-table" }, h("tbody", {}, SHORTCUTS.map(([k, d]) => h("tr", {}, h("th", { scope: "row" }, h("kbd", {}, k)), h("td", {}, d))))),
    actions: [{ label: "Close", value: true, kind: "primary" }],
  });
}

function onMenu(command) {
  if (typeof command !== "string") return;
  if (command.startsWith("navigate:")) navigate(command.slice("navigate:".length));
  else if (command === "refresh") refreshCurrent();
  else if (command === "shortcuts") showShortcuts();
}

function refreshCurrent() {
  if (current && current.instance && typeof current.instance.refresh === "function") current.instance.refresh();
  else if (current) mount(current.view, { focus: false });
}

document.addEventListener("keydown", (e) => {
  // fallback when the application menu is hidden (e.g. Linux with autoHideMenuBar)
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && /^[1-8]$/.test(e.key)) {
    e.preventDefault();
    navigate(VIEWS[Number(e.key) - 1].id);
  } else if (e.key === "F5" && !mod) {
    e.preventDefault();
    refreshCurrent();
  } else if (e.key === "F1") {
    e.preventDefault();
    showShortcuts();
  }
});

// ------------------------------------------------------------------ start

async function start() {
  if (!bridgeAvailable) {
    replace(viewRoot, emptyState("Preload bridge missing", "Denis Studio must be started through Electron (npm start)."));
    return;
  }
  buildNav();
  document.getElementById("new-window").addEventListener("click", () => api.app.newWindow().catch((err) => toastError(err)));
  try {
    const [settingsValue, status, appInfo] = await Promise.all([api.settings.get(), api.conn.status(), api.app.info()]);
    store.set({ settings: settingsValue, status, appInfo });
  } catch (err) {
    toastError(err, "Startup");
  }
  applyTheme(store.get().settings.theme);
  renderStatus(store.get());
  api.conn.onStatus((status) => store.set({ status }));
  api.settings.onChanged((next) => store.set({ settings: next }));
  api.app.onMenu(onMenu);
  store.subscribe(onStoreChange);
  navigate(store.get().status.state === "connected" ? "dashboard" : "connections");
}

start();

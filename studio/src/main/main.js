"use strict";

/**
 * Denis Studio - Electron main process.
 *
 * - one BrowserWindow per connection (File > New Window), each with its own
 *   ConnectionManager, keyed by webContents id
 * - renderer served from studio://app/ with a strict CSP (see security.js)
 * - contextIsolation + sandbox + no nodeIntegration; the preload exposes a
 *   fixed list of functions, every IPC argument is validated (see ipc.js)
 * - navigation, new windows, webviews and permission requests are denied
 * - DevTools are available in development; in packaged builds only when the
 *   environment variable DENIS_STUDIO_DEVTOOLS=1 is set
 */

const path = require("node:path");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  session,
  shell,
} = require("electron");

const security = require("./security");
const { ProfileStore } = require("./profiles");
const { SettingsStore, HistoryStore } = require("./stores");
const { ConnectionManager } = require("./connection");
const { createHandlers, registerIpc } = require("./ipc");

const RENDERER_ROOT = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload.js");
const DEVTOOLS_ALLOWED = !app.isPackaged || process.env.DENIS_STUDIO_DEVTOOLS === "1";

// Allow a separate profile directory (used by the smoke test and for testing multiple setups).
if (process.env.DENIS_STUDIO_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.DENIS_STUDIO_USER_DATA));
}

protocol.registerSchemesAsPrivileged([
  { scheme: security.SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
]);

/** Never print secrets: the manager only logs host/port and error codes. */
const logger = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
};

/** webContents.id -> {window, manager} */
const windows = new Map();

function loadDenisClient() {
  // eslint-disable-next-line global-require
  const mod = require("denis-client");
  return mod;
}

function createManager() {
  const { DenisClient } = loadDenisClient();
  return new ConnectionManager({ createClient: (options) => new DenisClient(options), logger });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    title: "Denis Studio",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111418" : "#f6f7f9",
    icon: path.join(RENDERER_ROOT, "assets", "icon.png"),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: DEVTOOLS_ALLOWED,
    },
  });
  const id = win.webContents.id;
  const manager = createManager();
  const forward = (status) => {
    if (!win.isDestroyed()) win.webContents.send("conn:status", status);
    const suffix = status.state === "connected" ? ` - ${status.name || status.host}` : "";
    if (!win.isDestroyed()) win.setTitle(`Denis Studio${suffix}`);
  };
  manager.on("status", forward);
  windows.set(id, { window: win, manager });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    manager.removeListener("status", forward);
    manager.disconnect().catch(() => {});
    windows.delete(id);
  });
  win.loadURL(security.START_URL);
  return win;
}

function focusedEntry() {
  const win = BrowserWindow.getFocusedWindow();
  return win ? windows.get(win.webContents.id) : null;
}

function sendMenu(command) {
  const entry = focusedEntry();
  if (entry) entry.window.webContents.send("app:menu", command);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const nav = (label, view, key) => ({ label, accelerator: `CmdOrCtrl+${key}`, click: () => sendMenu(`navigate:${view}`) });
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "&File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => sendMenu("navigate:settings") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "&View",
      submenu: [
        nav("Connections", "connections", "1"),
        nav("Dashboard", "dashboard", "2"),
        nav("Projects", "projects", "3"),
        nav("Keys", "keys", "4"),
        nav("SQL", "sql", "5"),
        nav("Backup && Restore", "backup", "6"),
        nav("Console", "console", "7"),
        nav("Settings", "settings", "8"),
        { type: "separator" },
        { label: "Refresh View", accelerator: "F5", click: () => sendMenu("refresh") },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(DEVTOOLS_ALLOWED ? [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] : []),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Keyboard Shortcuts", accelerator: "F1", click: () => sendMenu("shortcuts") },
        {
          label: "About Denis Studio",
          click: () => {
            const entry = focusedEntry();
            const opts = {
              type: "info",
              title: "About Denis Studio",
              message: `Denis Studio ${app.getVersion()}`,
              detail: `Electron ${process.versions.electron}\nChromium ${process.versions.chrome}\nNode ${process.versions.node}\n\nProfiles: ${path.join(app.getPath("userData"), "profiles.json")}`,
            };
            if (entry) dialog.showMessageBox(entry.window, opts);
            else dialog.showMessageBox(opts);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function hardenSessions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // Only our own scheme (and DevTools when allowed) may load anything.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const allowed = u.startsWith(`${security.SCHEME}://`) || (DEVTOOLS_ALLOWED && (u.startsWith("devtools://") || u.startsWith("chrome-extension://")));
    callback({ cancel: !allowed });
  });

  protocol.handle(security.SCHEME, async (request) => {
    const resolved = security.resolveAppPath(RENDERER_ROOT, request.url);
    if (!resolved) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    try {
      const body = await fsp.readFile(resolved.file);
      return new Response(body, { status: 200, headers: security.responseHeaders(resolved.type) });
    } catch {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
  });
}

app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (e, url) => {
    if (url !== contents.getURL()) e.preventDefault();
  });
  contents.on("will-redirect", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    // Links to the project's GitHub page open in the system browser; nothing opens inside the app.
    if (/^https:\/\/github\.com\/hacimertgokhan\/denis(\/|$)/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (!DEVTOOLS_ALLOWED) {
    contents.on("devtools-opened", () => contents.closeDevTools());
  }
});

function resolveContext(event) {
  const entry = windows.get(event.sender.id);
  if (!entry) return null;
  const frame = event.senderFrame;
  if (!frame || !security.isAppUrl(frame.url)) return null;
  if (frame.parent) return null; // top frame only
  return {
    windowId: event.sender.id,
    window: entry.window,
    manager: entry.manager,
    send: (channel, payload) => {
      if (!entry.window.isDestroyed()) entry.window.webContents.send(channel, payload);
    },
  };
}

function applyTheme(theme) {
  nativeTheme.themeSource = theme === "light" || theme === "dark" ? theme : "system";
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const profilesPath = path.join(userData, "profiles.json");
  const profiles = new ProfileStore({ filePath: profilesPath, safeStorage });
  const settings = new SettingsStore(path.join(userData, "settings.json"));
  const history = new HistoryStore(path.join(userData, "history.json"));
  applyTheme(settings.get().theme);

  const { handlers } = createHandlers({
    profiles,
    settings,
    history,
    clipboard,
    dialogs: {
      showSaveDialog: (ctx, opts) => dialog.showSaveDialog(ctx.window, opts),
      showOpenDialog: (ctx, opts) => dialog.showOpenDialog(ctx.window, opts),
    },
    files: {
      writeFile: (p, text) => fsp.writeFile(p, text, "utf8"),
      readFile: (p) => fsp.readFile(p, "utf8"),
      stat: (p) => fsp.stat(p),
    },
    openWindow: () => createWindow(),
    applyTheme,
    broadcastSettings: (next, fromId) => {
      for (const [id, entry] of windows) {
        if (id !== fromId && !entry.window.isDestroyed()) entry.window.webContents.send("settings:changed", next);
      }
    },
    appInfo: {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      profilesPath,
      devtools: DEVTOOLS_ALLOWED,
    },
    newHandle: () => crypto.randomUUID(),
  });

  hardenSessions();
  registerIpc(ipcMain, handlers, resolveContext);
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

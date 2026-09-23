# Denis Studio

A desktop application (Windows, macOS, Linux) to manage a
[Denis Database](../README.md) server: connect, browse and edit keys, run SQL,
watch server health, manage projects, and take or restore backups.

Built with Electron and plain HTML/CSS/JavaScript modules (no front-end
framework, no bundler). It talks to Denis from the main process through the
Node client in [`../clients/node`](../clients/node) (`denis-client`), using the
wire protocol described in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md).

## Features

| View | What it does |
| --- | --- |
| **Connections** | Saved profiles (name, host, port, group, default project token, color): add, edit, duplicate, delete. *Test connection* runs HELLO + LIN (and AUTH when a default project is set). After connecting it shows the server version, protocol and whether the group is an admin group. |
| **Dashboard** | Polls `INFO` every N seconds (default 2 s, see Settings): ops/s, connected clients, memory used vs `max-memory` (bar), keys (cache / durable), tables, hit ratio, evictions, uptime, persistence health (fsync mode, healthy, WAL size, last checkpoint, last error), JVM heap, traffic and, for admin groups, the last recovery. Sparklines (inline SVG) for ops/s and memory. Pause / refresh. |
| **Projects** | `PROJECTS` table with shortened token + copy button, owner, key and table counts. Create (shows the new token, "use now"), delete (typed confirmation of the token prefix), switch the current project (`AUTH` for the whole connection). |
| **Keys** | Glob search with layer filter (all / cache / durable) and limit, paginated list with layer badges and TTL. Detail panel: JSON values pretty-printed (saved compact), raw text otherwise; separate tabs when the cache and durable values differ. Save to cache or durable (+ optional TTL), delete a layer or both, EXPIRE / PERSIST, INCR helper for integer values, "New key" dialog, "Clear cache" (`HEAVEN`). Values that the line protocol cannot carry (line breaks, a word starting with `-&`) are explained and can be stored as a JSON string instead. |
| **SQL** | Monospace editor (Ctrl/Cmd+Enter runs, several statements separated by `;` run in order), optional JSON parameter array (sent with `QUERY`, safe from injection), results grid with client-side sorting, NULL shown distinctly, copy cell / row / all, CSV / JSON export via a save dialog, *Explain*, tables sidebar (`SHOW TABLES`, click = `DESCRIBE`, ▷ = `SELECT … LIMIT 100`), persisted history, statement timing. |
| **Backup & Restore** | Admin groups: `BACKUP` now, `BACKUPS` list (name, size, date, copy path), `SAVE` snapshot. Everyone: logical export of the current project (`DUMP` → `.denis.json` with metadata) and import from such a file (or a raw DUMP) with a preview (keys, tables, rows, existing-table conflicts), "replace existing tables" option, progress and result. |
| **Console** | Raw protocol lines with history (Up/Down) and pretty-printed JSON replies. `LIN` asks for confirmation (the password is masked in the history); `AUTH <token>` / `LIN` apply to the whole window's connection; `MODE` and `EXIT` are refused (the studio needs JSON mode). |
| **Settings** | Theme (system / light / dark), dashboard refresh interval, default key list limit, confirmation of destructive actions. |

Also: status bar (connection state, host:port, group, admin badge, current
project, latency of the last command, server version), toasts with the error
code (`SQL`, `AUTH`, `FORBIDDEN`, …), automatic reconnect with a visible
indicator after a server restart or network loss, keyboard shortcuts (F1),
multiple windows with one connection each (File → New Window, Ctrl/Cmd+Shift+N).

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + 1 … 8 | Switch view |
| F5 | Refresh the current view |
| Ctrl/Cmd + Shift + N | New window |
| Ctrl/Cmd + , | Settings |
| Ctrl/Cmd + Enter | Run SQL / save the key value |
| Ctrl/Cmd + Shift + E | Explain (SQL view) |
| Ctrl/Cmd + K / Ctrl/Cmd + N | Focus key search / new key (Keys view) |
| Up / Down | Console history |
| Arrow keys, Ctrl/Cmd + C (+ Shift) | Move in the result grid, copy cell (row) |
| F1 | Shortcut list |

## Screenshots

_Placeholder: add screenshots of the Connections, Dashboard, Keys and SQL
views here (`npm run test:electron` with `DENIS_STUDIO_SHOTS=<dir>` writes a
set of screenshots)._

## Getting started

Requirements: Node.js 20+ (tested with 22), npm 10.

```bash
cd studio
npm install        # links ../clients/node as denis-client
npm start          # development run (DevTools available)
```

Electron downloads its binary on the first run. If that fails behind a proxy,
see the [Electron installation docs](https://www.electronjs.org/docs/latest/tutorial/installation).

`denis-client` is a `file:` dependency, so `npm install` links the local
client; after changes to `../clients/node` no reinstall is needed in
development (packaging copies it into the app).

## Tests

```bash
npm test                # unit tests (node --test), no server needed
npm run test:e2e        # main-process modules against a real server
npm run test:electron   # Playwright _electron smoke test of the app
```

- **Unit tests** (`test/unit`): profile store (incl. encryption and the
  "no secure storage" fallback, injected fake `safeStorage`), IPC handlers and
  argument validation, the connection manager against a fake Denis TCP server
  (`test/helpers/fake-denis.js`, incl. server restart / reconnect) and a stub
  client, the client adapter, dump-file helpers, CSV/JSON export, console
  command classification, settings/history stores, the `studio://` protocol
  path resolution and CSP, the renderer's pure helpers (value rules, SQL
  splitting, sorting, history), and the icon encoders.
- **End-to-end** (`test/e2e/run-e2e.js`): set `DENIS_E2E_JAR=/path/to/denis.jar`
  and the script starts `java -jar … server` in a fresh temp directory on
  port `DENIS_E2E_PORT` (default 7103) with a bootstrap admin group, runs the
  whole feature set through the connection manager (keys, SQL, dump/import
  incl. a 20 000-row chunked import, backups, console), kills and restarts the
  server to check reconnect and durability, and stops it again. Without
  `DENIS_E2E_JAR` it uses an already running server
  (`DENIS_E2E_HOST/PORT/GROUP/PASSWORD`).
- **Electron smoke test** (`test/electron/smoke.spec.js`, needs the
  `playwright` dev dependency, no browser download): checks isolation (no
  Node in the renderer, only the fixed bridge), that the CSP blocks inline
  scripts/handlers and remote requests, that navigation and `window.open` are
  blocked, and, with `DENIS_E2E_JAR`, drives the UI end to end (profile,
  connect, project, keys, SQL + CSV export, backup, export/import, console).

## Building installers

```bash
npm run dist        # installers for the current OS
npm run dist:win    # Windows: NSIS installer + portable exe (x64)
npm run dist:mac    # macOS: dmg (x64 + arm64)
npm run dist:linux  # Linux: AppImage + deb
npm run dist:all    # all three (only works where every toolchain is available)
npm run pack        # unpacked app in dist/ (quick check)
```

Output goes to `dist/`, e.g. `dist/Denis-Studio-Setup-0.1.0-x64.exe` and
`dist/Denis-Studio-0.1.0-portable-x64.exe`.

Notes:

- Build each platform on that platform (or in CI with a matrix): dmg needs
  macOS, AppImage/deb are best built on Linux. `dist:all` is documented for a
  macOS host with the other toolchains available.
- The builds are **not code-signed**. Windows SmartScreen and macOS
  Gatekeeper will warn; configure `CSC_LINK`/`CSC_KEY_PASSWORD` (and Apple
  notarization) for releases. `hardenedRuntime` is already enabled for macOS.
- Icons live in `build/` and are generated by `npm run icons`
  (`scripts/make-icons.js`, no image libraries): `icon.svg` (source),
  `icon.png` (1024), `icons/NxN.png` (Linux), `icon.ico` (Windows) and
  `icon.icns` (macOS; PNG-compressed entries, supported since macOS 10.7).
- App id `io.github.hacimertgokhan.denis.studio`, product name "Denis Studio".
  The deb maintainer field uses a GitHub noreply address; change it in
  `package.json` if needed.

## Security model

- **Renderer isolation:** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`, no `webview`. The preload script
  (`src/preload.js`) exposes one object, `window.studio`, with a fixed list of
  functions (one per IPC channel). There is no generic "send any IPC"
  function.
- **Validation:** every IPC argument is validated in the main process
  (`src/main/validate.js`, `src/main/ipc.js`): types, lengths, one-word keys,
  no `-&` flags smuggled into keys/patterns, no line breaks, strict objects
  (unknown properties are rejected). Calls from any frame other than the
  app's top frame are refused. Replies are envelopes `{ok, value}` /
  `{ok:false, error:{message, code}}`, so error codes reach the UI.
- **Content:** the UI is served from a private `studio://app/` scheme (not
  `file://`); only files below `src/renderer` are reachable. Every response
  and the page carry a strict CSP (`default-src 'self'`, `script-src 'self'`,
  `style-src 'self'`, `connect-src 'none'`, `object-src 'none'`, no inline
  scripts or styles, no remote content). All other requests (http, https,
  file, …) are cancelled in the session. Server data is inserted with
  `textContent` only (never `innerHTML`).
- **Navigation:** in-app navigation, redirects, new windows and webviews are
  blocked; all permission requests (camera, notifications, …) are denied.
- **DevTools:** available when running from source (`npm start`); disabled in
  packaged builds unless the environment variable `DENIS_STUDIO_DEVTOOLS=1`
  is set.
- **Secrets:** passwords are encrypted with Electron `safeStorage` (DPAPI on
  Windows, Keychain on macOS, libsecret/kwallet on Linux). When no OS-backed
  encryption is available (including Linux's `basic_text` fallback), passwords
  are not saved at all and the app asks on every connect. Passwords are kept
  in memory only for automatic reconnects and are never logged; the console
  masks `LIN` passwords in its history. Exports contain only a shortened
  project token.

## Where data is stored

Everything lives in Electron's `userData` directory:

| OS | Directory |
| --- | --- |
| Windows | `%APPDATA%\Denis Studio` |
| macOS | `~/Library/Application Support/Denis Studio` |
| Linux | `~/.config/Denis Studio` |

- `profiles.json`: connection profiles (name, host, port, group, default
  project token, color) and, when available, the OS-encrypted password.
  Written atomically with mode 0600. A corrupt file is kept aside as
  `profiles.json.broken-<time>`.
- `settings.json`: theme, refresh interval, key limit, confirmations.
- `history.json`: SQL and console history (200 entries each; `LIN`
  passwords masked).

The Connections page and Settings → About show the exact path. Set
`DENIS_STUDIO_USER_DATA=<dir>` to use a different directory (handy for
testing).

## Export file format (`.denis.json`)

```json
{
  "kind": "denis-studio-export",
  "formatVersion": 1,
  "exportedAt": "2026-09-23T18:00:00.000Z",
  "studio": { "version": "0.1.0" },
  "source": { "host": "127.0.0.1", "port": 5142, "group": "app", "project": "7dMs9h2f…vvh5", "serverVersion": "0.1.0-alpha" },
  "summary": { "keys": 3, "cacheKeys": 3, "persistentKeys": 2, "ttlKeys": 1, "tables": 1, "rows": 2 },
  "dump": { "format": 1, "cache": {}, "persistent": {}, "ttl": {}, "tables": {} }
}
```

`dump` is the `DUMP` reply without `ok`, i.e. exactly what `IMPORT` accepts;
a raw DUMP object is accepted on import as well. TTLs are the milliseconds
left at export time and start again when imported. Imports go through
`denis-client`'s `import()`, which splits large dumps into several `IMPORT`
lines (tables larger than one line continue with `"append": true`).

## Project layout

```
studio/
  package.json            scripts + electron-builder configuration
  build/                  icons (generated by scripts/make-icons.js)
  scripts/make-icons.js   PNG / ICO / ICNS generator
  src/
    preload.js            contextBridge API (fixed functions)
    main/
      main.js             app lifecycle, windows, menu, session hardening
      security.js         studio:// protocol, CSP, URL checks
      ipc.js              IPC handler table + validation + envelopes
      validate.js         schema validators
      connection.js       ConnectionManager (one per window, reconnect)
      denis-api.js        adapter over denis-client (normalised results, error codes)
      profiles.js         profile store with safeStorage encryption
      stores.js           settings + history
      dumpfile.js         .denis.json wrap / parse / summary
      export.js           CSV / JSON / TSV
      console-commands.js console line classification + masking
    renderer/
      index.html, styles.css, app.js (router, status bar, shortcuts)
      api.js, store.js
      components/         dialogs, toasts, data grid, sparkline, icons, …
      views/              connections, dashboard, projects, keys, sql, backup, console, settings
      util/               pure helpers (value rules, SQL, formatting, history)
  test/
    unit/                 node --test
    helpers/fake-denis.js fake TCP server
    e2e/run-e2e.js        real-server scenario
    electron/smoke.spec.js
```

## Troubleshooting

- **"Password required" on connect:** the profile has no saved password (or
  it cannot be decrypted, e.g. after copying `profiles.json` to another
  machine); enter it when asked, or edit the profile to save it again.
- **`LOCKED`:** too many failed logins from this address; wait for
  `login-lockout-seconds`.
- **The key list says the limit was reached:** refine the pattern or raise the
  limit; the server also caps `KEYS` with its `keys-limit` setting.

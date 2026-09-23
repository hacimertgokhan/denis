"use strict";

/**
 * IPC surface between the renderer and the main process.
 *
 * `createHandlers(deps)` returns a table `channel -> {args, handle}` where
 * `args` validates the positional arguments (arrays of validators) and
 * `handle(ctx, ...validatedArgs)` does the work. The table is pure (all side
 * effects are injected) so it is unit-tested without Electron.
 *
 * `registerIpc(ipcMain, handlers, resolveContext)` wires it to Electron:
 * every call is checked for a trusted sender, validated, and answered with an
 * envelope `{ok:true, value}` / `{ok:false, error:{message, code}}` so error
 * codes survive the IPC boundary (Electron would flatten thrown errors).
 */

const v = require("./validate");
const { StudioError, normalizeError } = require("./denis-api");
const consoleCommands = require("./console-commands");
const dumpfile = require("./dumpfile");
const exporter = require("./export");

// ------------------------------------------------------------------ validators

const noFlag = (check) => (value, path) => {
  const out = check(value, path);
  if (typeof out === "string" && out.startsWith("-&")) throw new v.ValidationError(`${path} must not start with -&`);
  return out;
};

const keyArg = noFlag(v.key());
const patternArg = noFlag(v.pattern());
const tokenArg = v.token();
const layerArg = v.oneOf(["any", "cache", "persistent"], { optional: true });
const delLayerArg = v.oneOf(["both", "cache", "persistent"]);
const sourceArg = v.oneOf(["default", "cache", "persistent"], { optional: true });
const ttlSeconds = v.int({ min: 1, max: 10 * 365 * 24 * 3600, optional: true });
/** SET values: one line; the adapter rejects `-&` words with a clear message. */
const valueArg = v.str({ min: 1, max: 8 * 1024 * 1024 - 4096, noLineBreaks: true });
const sqlArg = v.str({ min: 1, max: 4 * 1024 * 1024 });
const paramsArg = v.arr(v.jsonValue({ maxDepth: 4 }), { max: 1000, optional: true });
const consoleLine = v.str({ min: 1, max: 8 * 1024 * 1024 - 16, noLineBreaks: true });
const historyKind = v.oneOf(["sql", "console"]);
const handleArg = v.str({ min: 8, max: 64, pattern: /^[a-f0-9-]+$/ });
const cellValue = (value, path) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object") return v.jsonValue({ maxDepth: 6 })(value, path);
  throw new v.ValidationError(`${path} is not a result cell`);
};
const resultExport = v.obj({
  columns: v.arr(v.str({ max: 1024 }), { min: 1, max: 4096 }),
  rows: v.arr(v.arr(cellValue, { max: 4096 }), { max: 2_000_000 }),
  format: v.oneOf(["csv", "json"]),
  name: v.str({ max: 120, optional: true, pattern: /^[A-Za-z0-9 _.\-]*$/ }),
});

const targetArg = v.obj({
  profileId: v.id({ optional: true }),
  name: v.str({ max: 80, optional: true }),
  host: v.host(),
  port: v.port(),
  group: v.group(),
  token: v.str({ max: 512, optional: true, trim: true, pattern: /^[A-Za-z0-9_\-.]*$/, patternMessage: "is not a valid project token" }),
  color: v.color({ optional: true }),
});

const secretArg = v.obj(
  {
    password: v.password({ optional: true }),
    savePassword: v.bool({ optional: true }),
  },
  { optional: true },
);

// ------------------------------------------------------------------ handlers

/**
 * @param {object} deps
 * @param {import('./profiles').ProfileStore} deps.profiles
 * @param {import('./stores').SettingsStore} deps.settings
 * @param {import('./stores').HistoryStore} deps.history
 * @param {{showSaveDialog: Function, showOpenDialog: Function}} deps.dialogs  (ctx, options) => result
 * @param {{writeFile: Function, readFile: Function, stat: Function}} deps.files  promise based
 * @param {{writeText: Function}} deps.clipboard
 * @param {() => void} deps.openWindow
 * @param {(theme: string) => void} [deps.applyTheme]
 * @param {{version: string, electron?: string, platform?: string, profilesPath?: string}} deps.appInfo
 * @param {() => string} deps.newHandle
 */
function createHandlers(deps) {
  const pendingImports = new Map(); // windowId -> {handle, dump, summary, fileName}

  const needConnection = (ctx) => {
    if (!ctx.manager) throw new StudioError("No connection manager for this window", "INTERNAL");
    return ctx.manager;
  };
  const run = (ctx, fn) => needConnection(ctx).run(fn);

  const passwordFor = (profileId, given) => {
    if (typeof given === "string") return given;
    if (profileId) {
      const stored = deps.profiles.getPassword(profileId);
      if (stored !== null) return stored;
    }
    return null;
  };

  const handlers = {
    // ------------------------------------------------------------- profiles
    "profiles:list": { args: [], handle: () => deps.profiles.list() },
    "profiles:storage": {
      args: [],
      handle: () => ({ encryptionAvailable: deps.profiles.encryptionAvailable(), path: deps.appInfo.profilesPath || null, loadError: deps.profiles.loadError || null }),
    },
    "profiles:save": {
      args: [v.obj({ id: v.id({ optional: true }), name: v.str({ max: 200 }), host: v.str({ max: 300 }), port: v.int(), group: v.str({ max: 200 }), token: v.str({ max: 600, optional: true }), color: v.str({ max: 16, optional: true }) }), secretArg],
      handle: (ctx, profile, secret) => deps.profiles.save(profile, secret || {}),
    },
    "profiles:delete": { args: [v.id()], handle: (ctx, id) => deps.profiles.delete(id) },
    "profiles:duplicate": { args: [v.id()], handle: (ctx, id) => deps.profiles.duplicate(id) },

    // ------------------------------------------------------------- connection
    "conn:test": {
      args: [targetArg, v.password({ optional: true })],
      handle: async (ctx, target, password) => {
        const pw = passwordFor(target.profileId, password);
        if (pw === null) throw new StudioError("Password required", "NEEDPASSWORD");
        return needConnection(ctx).test(target, pw);
      },
    },
    "conn:connect": {
      args: [v.id(), v.password({ optional: true })],
      handle: async (ctx, profileId, password) => {
        const profile = deps.profiles.get(profileId);
        if (!profile) throw new StudioError("Profile not found", "NOTFOUND");
        const pw = passwordFor(profileId, password);
        if (pw === null) throw new StudioError("Password required", "NEEDPASSWORD");
        return needConnection(ctx).connect(
          { profileId, name: profile.name, host: profile.host, port: profile.port, group: profile.group, token: profile.token || undefined, color: profile.color },
          pw,
        );
      },
    },
    "conn:disconnect": {
      args: [],
      handle: async (ctx) => {
        pendingImports.delete(ctx.windowId);
        await needConnection(ctx).disconnect();
        return needConnection(ctx).getStatus();
      },
    },
    "conn:status": { args: [], handle: (ctx) => needConnection(ctx).getStatus() },

    // ------------------------------------------------------------- server / projects
    "db:info": { args: [], handle: (ctx) => run(ctx, (api) => api.info()) },
    "db:dbsize": { args: [], handle: (ctx) => run(ctx, (api) => api.dbsize()) },
    "db:projects": { args: [], handle: (ctx) => run(ctx, (api) => api.projects()) },
    "db:createProject": { args: [], handle: (ctx) => run(ctx, (api) => api.createProject()) },
    "db:deleteProject": { args: [tokenArg], handle: (ctx, token) => needConnection(ctx).deleteProject(token) },
    "db:use": { args: [tokenArg], handle: (ctx, token) => needConnection(ctx).use(token) },

    // ------------------------------------------------------------- keys
    "db:keys": {
      args: [v.obj({ pattern: patternArg, layer: layerArg, limit: v.int({ min: 1, max: 1_000_000, optional: true }) })],
      handle: (ctx, q) => run(ctx, (api) => api.keys(q.pattern, { layer: q.layer || "any", limit: q.limit })),
    },
    "db:keyMeta": { args: [v.arr(keyArg, { max: 500 })], handle: (ctx, keys) => run(ctx, (api) => api.keyMeta(keys)) },
    "db:get": {
      args: [keyArg, sourceArg],
      handle: (ctx, key, source) => run(ctx, (api) => api.get(key, { source: source === "default" ? undefined : source })),
    },
    "db:set": {
      args: [v.obj({ key: keyArg, value: valueArg, persist: v.bool({ optional: true }), ttl: ttlSeconds })],
      handle: (ctx, o) => run(ctx, (api) => api.set(o.key, o.value, { persist: !!o.persist, ttl: o.ttl })),
    },
    "db:del": { args: [keyArg, delLayerArg], handle: (ctx, key, layer) => run(ctx, (api) => api.del(key, layer)) },
    "db:expire": { args: [keyArg, v.int({ min: 1, max: 10 * 365 * 24 * 3600 })], handle: (ctx, key, s) => run(ctx, (api) => api.expire(key, s)) },
    "db:persist": { args: [keyArg], handle: (ctx, key) => run(ctx, (api) => api.persist(key)) },
    "db:incr": {
      args: [keyArg, v.int({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), v.bool({ optional: true })],
      handle: (ctx, key, delta, persist) => run(ctx, (api) => api.incr(key, delta, { persist: !!persist })),
    },
    "db:clearCache": { args: [], handle: (ctx) => run(ctx, (api) => api.clearCache()) },

    // ------------------------------------------------------------- SQL
    "db:query": {
      args: [sqlArg, paramsArg],
      handle: async (ctx, sql, params) => {
        const started = process.hrtime.bigint();
        const result = await run(ctx, (api) => api.query(sql, params || []));
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        return { result, ms: Math.round(ms * 100) / 100 };
      },
    },

    // ------------------------------------------------------------- admin
    "db:save": { args: [], handle: (ctx) => run(ctx, (api) => api.save()) },
    "db:backup": { args: [], handle: (ctx) => run(ctx, (api) => api.backup()) },
    "db:backups": { args: [], handle: (ctx) => run(ctx, (api) => api.backups()) },

    // ------------------------------------------------------------- console
    "console:send": {
      args: [consoleLine, v.obj({ confirmed: v.bool({ optional: true }) }, { optional: true })],
      handle: async (ctx, line, opts) => {
        const cmd = consoleCommands.classify(line);
        const shown = consoleCommands.maskSecrets(cmd.line);
        const manager = needConnection(ctx);
        switch (cmd.kind) {
          case "empty":
            return { kind: "empty", shown };
          case "refuse":
            return { kind: "refused", shown, message: cmd.reason };
          case "lin":
            if (!(opts && opts.confirmed)) return { kind: "confirm", shown, message: "LIN sends a password in clear text over this connection and logs the whole session in again." };
            return { kind: "session", shown, status: await manager.relogin(cmd.group, cmd.password) };
          case "auth-use":
            return { kind: "session", shown, status: await manager.use(cmd.token) };
          case "auth-delete":
            return { kind: "session", shown, status: await manager.deleteProject(cmd.token) };
          default: {
            const started = process.hrtime.bigint();
            const reply = await manager.run((api) => api.command(cmd.line));
            return { kind: "reply", shown, reply, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100 };
          }
        }
      },
    },

    // ------------------------------------------------------------- logical backup
    "dump:export": {
      args: [],
      handle: async (ctx) => {
        const manager = needConnection(ctx);
        const status = manager.getStatus();
        if (!status.project) throw new StudioError("Select a project first", "NOPROJECT");
        const dump = await manager.run((api) => api.dump());
        const file = dumpfile.wrapDump(dump, {
          host: status.host,
          port: status.port,
          group: status.group,
          project: status.project,
          serverVersion: status.version,
          studioVersion: deps.appInfo.version,
        });
        const choice = await deps.dialogs.showSaveDialog(ctx, {
          title: "Export project",
          defaultPath: dumpfile.suggestFileName(status.project),
          filters: [{ name: "Denis export", extensions: ["denis.json", "json"] }],
        });
        if (choice.canceled || !choice.filePath) return { canceled: true, summary: file.summary };
        const text = dumpfile.serialize(file);
        await deps.files.writeFile(choice.filePath, text);
        return { canceled: false, path: choice.filePath, bytes: Buffer.byteLength(text), summary: file.summary };
      },
    },
    "dump:open": {
      args: [],
      handle: async (ctx) => {
        const choice = await deps.dialogs.showOpenDialog(ctx, {
          title: "Import project data",
          properties: ["openFile"],
          filters: [
            { name: "Denis export", extensions: ["json"] },
            { name: "All files", extensions: ["*"] },
          ],
        });
        if (choice.canceled || !choice.filePaths || !choice.filePaths[0]) return { canceled: true };
        const filePath = choice.filePaths[0];
        const stat = await deps.files.stat(filePath);
        if (stat.size > dumpfile.MAX_FILE_BYTES) throw new StudioError(`File is too large (${Math.round(stat.size / 1048576)} MB)`, "LIMIT");
        const text = await deps.files.readFile(filePath);
        let parsed;
        try {
          parsed = dumpfile.parseDumpFile(text);
        } catch (err) {
          throw new StudioError(`Cannot import ${baseName(filePath)}: ${err.message}`, err.code || "EFORMAT");
        }
        const handle = deps.newHandle();
        pendingImports.set(ctx.windowId, { handle, dump: parsed.dump, summary: parsed.summary, fileName: baseName(filePath) });
        return { canceled: false, handle, fileName: baseName(filePath), bytes: stat.size, meta: parsed.meta, summary: parsed.summary };
      },
    },
    "dump:import": {
      args: [handleArg, v.obj({ replace: v.bool({ optional: true }) })],
      handle: async (ctx, handle, opts) => {
        const pending = pendingImports.get(ctx.windowId);
        if (!pending || pending.handle !== handle) throw new StudioError("Choose the file again (import expired)", "EINVAL");
        const manager = needConnection(ctx);
        if (!manager.getStatus().project) throw new StudioError("Select a project first", "NOPROJECT");
        const started = Date.now();
        const progress = (p) => ctx.send("import:progress", { handle, ...p });
        const imported = await manager.run((api) => api.import(pending.dump, { replace: !!opts.replace, onProgress: progress }));
        pendingImports.delete(ctx.windowId);
        return { imported, ms: Date.now() - started, fileName: pending.fileName };
      },
    },
    "dump:discard": {
      args: [handleArg],
      handle: (ctx, handle) => {
        const pending = pendingImports.get(ctx.windowId);
        if (pending && pending.handle === handle) pendingImports.delete(ctx.windowId);
        return true;
      },
    },

    // ------------------------------------------------------------- result export
    "result:export": {
      args: [resultExport],
      handle: async (ctx, o) => {
        const ext = o.format === "csv" ? "csv" : "json";
        const choice = await deps.dialogs.showSaveDialog(ctx, {
          title: `Export result as ${ext.toUpperCase()}`,
          defaultPath: `${o.name || "result"}.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (choice.canceled || !choice.filePath) return { canceled: true };
        const text = o.format === "csv" ? exporter.toCsv(o.columns, o.rows, { bom: true }) : exporter.toJson(o.columns, o.rows);
        await deps.files.writeFile(choice.filePath, text);
        return { canceled: false, path: choice.filePath, rows: o.rows.length };
      },
    },

    // ------------------------------------------------------------- app
    "app:copy": {
      args: [v.str({ max: 16 * 1024 * 1024 })],
      handle: (ctx, text) => {
        deps.clipboard.writeText(text);
        return true;
      },
    },
    "app:copyRows": {
      args: [v.obj({ columns: v.arr(v.str({ max: 1024 }), { min: 1, max: 4096 }), rows: v.arr(v.arr(cellValue, { max: 4096 }), { max: 100000 }), header: v.bool({ optional: true }) })],
      handle: (ctx, o) => {
        deps.clipboard.writeText(exporter.toTsv(o.columns, o.rows, { header: o.header !== false }));
        return true;
      },
    },
    "app:newWindow": {
      args: [],
      handle: () => {
        deps.openWindow();
        return true;
      },
    },
    "app:info": { args: [], handle: () => ({ ...deps.appInfo }) },

    // ------------------------------------------------------------- settings / history
    "settings:get": { args: [], handle: () => deps.settings.get() },
    "settings:set": {
      args: [v.obj({ theme: v.str({ max: 16, optional: true }), refreshMs: v.num({ optional: true }), keyLimit: v.num({ optional: true }), confirmDestructive: v.bool({ optional: true }) })],
      handle: (ctx, patch) => {
        const next = deps.settings.set(patch);
        if (deps.applyTheme) deps.applyTheme(next.theme);
        if (deps.broadcastSettings) deps.broadcastSettings(next, ctx.windowId);
        return next;
      },
    },
    "history:list": { args: [historyKind], handle: (ctx, kind) => deps.history.list(kind) },
    "history:add": {
      args: [historyKind, v.str({ min: 1, max: 100 * 1024 })],
      handle: (ctx, kind, entry) => deps.history.add(kind, kind === "console" ? consoleCommands.maskSecrets(entry) : entry),
    },
    "history:clear": { args: [historyKind], handle: (ctx, kind) => deps.history.clear(kind) },
  };

  return { handlers, pendingImports };
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

/**
 * Validate and run one call. Always resolves with an envelope.
 * @returns {Promise<{ok: true, value: any} | {ok: false, error: {message: string, code: string}}>}
 */
async function dispatch(handlers, channel, ctx, rawArgs) {
  const entry = Object.prototype.hasOwnProperty.call(handlers, channel) ? handlers[channel] : null;
  if (!entry) return { ok: false, error: { message: `Unknown channel ${channel}`, code: "EINVAL" } };
  try {
    if (!Array.isArray(rawArgs)) throw new v.ValidationError("arguments must be an array");
    if (rawArgs.length > entry.args.length) {
      // trailing undefined values are fine (optional args), anything else is not
      if (rawArgs.slice(entry.args.length).some((a) => a !== undefined)) throw new v.ValidationError(`${channel} takes at most ${entry.args.length} argument(s)`);
    }
    const args = entry.args.map((check, i) => check(rawArgs[i], `${channel} argument ${i + 1}`));
    const value = await entry.handle(ctx, ...args);
    return { ok: true, value: value === undefined ? null : value };
  } catch (err) {
    const e = err instanceof v.ValidationError ? err : normalizeError(err);
    return { ok: false, error: { message: e.message, code: e.code || "ERROR" } };
  }
}

/**
 * Wire handlers into Electron's ipcMain.
 * @param {Electron.IpcMain} ipcMain
 * @param {Record<string, {args: Function[], handle: Function}>} handlers
 * @param {(event: Electron.IpcMainInvokeEvent) => object|null} resolveContext  null = untrusted sender
 */
function registerIpc(ipcMain, handlers, resolveContext) {
  for (const channel of Object.keys(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      const ctx = resolveContext(event);
      if (!ctx) return { ok: false, error: { message: "Untrusted sender", code: "FORBIDDEN" } };
      return dispatch(handlers, channel, ctx, args);
    });
  }
}

module.exports = { createHandlers, dispatch, registerIpc };

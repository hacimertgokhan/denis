"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, dispatch, registerIpc } = require("../../src/main/ipc");
const { StudioError } = require("../../src/main/denis-api");

/** A fake manager whose run() hands a recording api to the handler. */
function fakeManager(overrides = {}) {
  const calls = [];
  const api = new Proxy(
    {},
    {
      get: (_t, name) =>
        overrides[name] ||
        ((...args) => {
          calls.push([name, ...args]);
          return Promise.resolve({ called: name, args });
        }),
    },
  );
  return {
    calls,
    status: { state: "connected", host: "h", port: 1, group: "g", project: "tok", version: "0.1.0" },
    getStatus() {
      return { ...this.status };
    },
    run: (fn) => fn(api),
    connect: async (target, pw) => ({ connectedWith: target, pwLength: pw.length }),
    test: async (target, pw) => ({ tested: target, pwLength: pw.length }),
    use: async (token) => ({ project: token }),
    deleteProject: async (token) => ({ deleted: token }),
    relogin: async (group) => ({ group }),
    disconnect: async () => {},
  };
}

function setup(extra = {}) {
  const written = [];
  const copied = [];
  const progress = [];
  const deps = {
    profiles: {
      list: () => [{ id: "p1" }],
      get: (id) => (id === "p1" ? { id: "p1", name: "P", host: "127.0.0.1", port: 5142, group: "g", token: "", color: "#000000" } : null),
      getPassword: (id) => (id === "p1" ? "stored" : null),
      save: (p, s) => ({ profile: p, secret: s }),
      delete: () => true,
      duplicate: () => ({}),
      encryptionAvailable: () => true,
    },
    settings: { get: () => ({ theme: "system" }), set: (p) => ({ theme: "system", ...p }) },
    history: { list: () => [], add: (k, e) => [e], clear: () => [] },
    dialogs: {
      showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/out.file" }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/in.denis.json"] }),
    },
    files: {
      writeFile: async (p, t) => written.push([p, t]),
      readFile: async () => JSON.stringify({ kind: "denis-studio-export", formatVersion: 1, dump: { format: 1, cache: { a: "1" }, persistent: {}, ttl: {}, tables: {} } }),
      stat: async () => ({ size: 100 }),
    },
    clipboard: { writeText: (t) => copied.push(t) },
    openWindow: () => {},
    appInfo: { version: "0.1.0" },
    newHandle: () => "0123456789abcdef",
    ...extra,
  };
  const { handlers } = createHandlers(deps);
  const manager = fakeManager();
  const ctx = { windowId: 1, manager, send: (ch, p) => progress.push([ch, p]) };
  return { handlers, ctx, manager, written, copied, progress, deps };
}

test("dispatch wraps success and errors in envelopes", async () => {
  const { handlers, ctx } = setup();
  assert.deepEqual(await dispatch(handlers, "profiles:list", ctx, []), { ok: true, value: [{ id: "p1" }] });
  const unknown = await dispatch(handlers, "nope", ctx, []);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "EINVAL");
});

test("rejects invalid arguments before touching the connection", async () => {
  const { handlers, ctx, manager } = setup();
  const cases = [
    ["db:get", ["two words"]],
    ["db:get", [42]],
    ["db:get", ["k", "sideways"]],
    ["db:set", [{ key: "k", value: "a\nb" }]],
    ["db:set", [{ key: "k", value: "v", ttl: -5 }]],
    ["db:set", [{ key: "k", value: "v", evil: true }]],
    ["db:keys", [{ pattern: "-&cache" }]],
    ["db:keys", [{ pattern: "a b" }]],
    ["db:keys", [{ pattern: "*", layer: "all" }]],
    ["db:del", ["k", "everything"]],
    ["db:expire", ["k", 0]],
    ["db:incr", ["k", 1.5]],
    ["db:use", ["not a token"]],
    ["db:query", [""]],
    ["db:query", ["SELECT 1", "not-an-array"]],
    ["db:keyMeta", [Array.from({ length: 501 }, (_, i) => `k${i}`)]],
    ["console:send", ["a\nb"]],
    ["conn:connect", ["../../etc"]],
    ["history:add", ["other", "x"]],
    ["db:info", ["unexpected"]],
  ];
  for (const [channel, args] of cases) {
    const r = await dispatch(handlers, channel, ctx, args);
    assert.equal(r.ok, false, `${channel} ${JSON.stringify(args).slice(0, 60)} should fail`);
    assert.equal(r.error.code, "EINVAL", `${channel}: ${r.error.message}`);
  }
  assert.equal(manager.calls.length, 0);
});

test("valid calls reach the api with normalised arguments", async () => {
  const { handlers, ctx, manager } = setup();
  let r = await dispatch(handlers, "db:set", ctx, [{ key: "k", value: "v w", persist: true, ttl: 30 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(manager.calls.at(-1), ["set", "k", "v w", { persist: true, ttl: 30 }]);
  r = await dispatch(handlers, "db:keys", ctx, [{ pattern: "user:*", limit: 10 }]);
  assert.deepEqual(manager.calls.at(-1), ["keys", "user:*", { layer: "any", limit: 10 }]);
  r = await dispatch(handlers, "db:get", ctx, ["k", "persistent"]);
  assert.deepEqual(manager.calls.at(-1), ["get", "k", { source: "persistent" }]);
  r = await dispatch(handlers, "db:query", ctx, ["SELECT ?", [1]]);
  assert.equal(r.ok, true);
  assert.equal(typeof r.value.ms, "number");
  assert.deepEqual(manager.calls.at(-1), ["query", "SELECT ?", [1]]);
});

test("conn:connect uses the stored password or asks for one", async () => {
  const { handlers, ctx, deps } = setup();
  let r = await dispatch(handlers, "conn:connect", ctx, ["p1"]);
  assert.equal(r.ok, true);
  assert.equal(r.value.pwLength, "stored".length);
  r = await dispatch(handlers, "conn:connect", ctx, ["p1", "typed"]);
  assert.equal(r.value.pwLength, 5);
  deps.profiles.getPassword = () => null;
  r = await dispatch(handlers, "conn:connect", ctx, ["p1"]);
  assert.equal(r.error.code, "NEEDPASSWORD");
  r = await dispatch(handlers, "conn:connect", ctx, ["p2", "x"]);
  assert.equal(r.error.code, "NOTFOUND");
});

test("console:send classifies LIN/MODE/AUTH and masks passwords", async () => {
  const { handlers, ctx, manager } = setup();
  let r = await dispatch(handlers, "console:send", ctx, ["MODE text"]);
  assert.equal(r.value.kind, "refused");
  r = await dispatch(handlers, "console:send", ctx, ["LIN admin top secret"]);
  assert.equal(r.value.kind, "confirm");
  assert.equal(r.value.shown, "LIN admin ********");
  r = await dispatch(handlers, "console:send", ctx, ["LIN admin top secret", { confirmed: true }]);
  assert.equal(r.value.kind, "session");
  assert.deepEqual(r.value.status, { group: "admin" });
  r = await dispatch(handlers, "console:send", ctx, ["AUTH tok9"]);
  assert.deepEqual(r.value.status, { project: "tok9" });
  r = await dispatch(handlers, "console:send", ctx, ["DBSIZE"]);
  assert.equal(r.value.kind, "reply");
  assert.deepEqual(manager.calls.at(-1), ["command", "DBSIZE"]);
});

test("history:add masks console LIN passwords", async () => {
  const { handlers, ctx } = setup();
  const r = await dispatch(handlers, "history:add", ctx, ["console", "LIN g hunter2"]);
  assert.deepEqual(r.value, ["LIN g ********"]);
});

test("dump:export wraps the dump and writes it; needs a project", async () => {
  const { handlers, ctx, manager, written } = setup();
  const r = await dispatch(handlers, "dump:export", ctx, []);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(written.length, 1);
  const file = JSON.parse(written[0][1]);
  assert.equal(file.kind, "denis-studio-export");
  assert.equal(file.source.project, "tok");
  manager.status.project = null;
  const r2 = await dispatch(handlers, "dump:export", ctx, []);
  assert.equal(r2.error.code, "NOPROJECT");
});

test("dump:open + dump:import pass the parsed dump and report progress", async () => {
  const { handlers, ctx, manager } = setup();
  const opened = await dispatch(handlers, "dump:open", ctx, []);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(opened.value.summary.cacheKeys, 1);
  const bad = await dispatch(handlers, "dump:import", ctx, ["ffffffffffffffff", {}]);
  assert.equal(bad.ok, false);
  const r = await dispatch(handlers, "dump:import", ctx, [opened.value.handle, { replace: true }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const call = manager.calls.at(-1);
  assert.equal(call[0], "import");
  assert.deepEqual(call[1].cache, { a: "1" });
  assert.equal(call[2].replace, true);
  const again = await dispatch(handlers, "dump:import", ctx, [opened.value.handle, {}]);
  assert.equal(again.ok, false, "a handle is single use");
});

test("result:export writes CSV / JSON through the save dialog", async () => {
  const { handlers, ctx, written } = setup();
  const r = await dispatch(handlers, "result:export", ctx, [{ columns: ["a", "b"], rows: [[1, null]], format: "csv" }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(written[0][1], "﻿a,b\r\n1,\r\n");
  const bad = await dispatch(handlers, "result:export", ctx, [{ columns: ["a"], rows: [[() => 1]], format: "csv" }]);
  assert.equal(bad.ok, false);
});

test("server errors keep their code through the envelope", async () => {
  const { handlers, ctx, manager } = setup();
  manager.run = async () => {
    throw new StudioError("Table not found: t", "SQL");
  };
  const r = await dispatch(handlers, "db:query", ctx, ["SELECT * FROM t"]);
  assert.deepEqual(r, { ok: false, error: { message: "Table not found: t", code: "SQL" } });
});

test("registerIpc refuses untrusted senders", async () => {
  const { handlers } = setup();
  const registered = new Map();
  registerIpc({ handle: (ch, fn) => registered.set(ch, fn) }, handlers, (event) => (event.trusted ? { windowId: 1, manager: fakeManager() } : null));
  assert.ok(registered.has("db:get"));
  const denied = await registered.get("profiles:list")({ trusted: false });
  assert.equal(denied.error.code, "FORBIDDEN");
  const allowed = await registered.get("profiles:list")({ trusted: true });
  assert.equal(allowed.ok, true);
});

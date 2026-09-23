"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApi, normalizeError, chunkDump, isConnectionError, StudioError } = require("../../src/main/denis-api");

/** Legacy-style client: only command(). */
function commandClient(replies) {
  const lines = [];
  return {
    lines,
    async command(line) {
      lines.push(line);
      const r = typeof replies === "function" ? replies(line) : replies[line.split(" ")[0]];
      return r === undefined ? { ok: true } : r;
    },
  };
}

test("falls back to command() with the documented protocol lines", async () => {
  const c = commandClient({
    KEYS: { ok: true, keys: ["a", "b"], count: 2, truncated: true },
    INFO: { ok: true, info: { server: { version: "1" } } },
    PROJECTS: { ok: true, projects: [{ token: "t", owner: null, keys: 1, tables: 0, current: true }], count: 1 },
    GET: { ok: false, key: "x", error: "not found", code: "NOTFOUND" },
    INCR: { ok: true, key: "n", data: "5", value: 5 },
    QUERY: { ok: true, columns: ["a"], rows: [[1]], count: 1, data: "[]" },
    BACKUPS: { ok: true, backups: [{ name: "b", path: "p", bytes: 3, createdAt: "d" }], directory: "dir" },
  });
  const api = createApi(c);
  assert.equal(api.modern, false);
  assert.deepEqual(await api.keys("*", { layer: "persistent", limit: 2 }), { keys: ["a", "b"], count: 2, truncated: true });
  assert.equal(c.lines.at(-1), "KEYS * -&protobuff -&limit=2");
  assert.deepEqual(await api.info(), { server: { version: "1" } });
  assert.equal((await api.projects())[0].current, true);
  assert.equal(await api.get("x"), null);
  await api.get("x", { source: "persistent" });
  assert.equal(c.lines.at(-1), "GET x -&from-protobuff");
  assert.equal(await api.incr("n", 2, { persist: true }), 5);
  assert.equal(c.lines.at(-1), "INCR n 2 -&save");
  await api.set("k", "v w", { persist: true, ttl: 9 });
  assert.equal(c.lines.at(-1), "SET k v w -&save -&ttl=9");
  await api.del("k", "cache");
  assert.equal(c.lines.at(-1), "DEL k -&cache");
  const q = await api.query("SELECT ?", [1]);
  assert.deepEqual(q, { columns: ["a"], rows: [[1]], count: 1 });
  assert.equal(c.lines.at(-1), 'QUERY {"sql":"SELECT ?","params":[1]}');
  assert.deepEqual(await api.backups(), { directory: "dir", backups: [{ name: "b", path: "p", bytes: 3, createdAt: "d" }] });
  assert.ok(api.fallbacks.has("info"));
});

test("ok:false replies become StudioErrors with the server code", async () => {
  const api = createApi(commandClient({ SAVE: { ok: false, error: "This command needs an admin group", code: "FORBIDDEN" } }));
  await assert.rejects(api.save(), (e) => e instanceof StudioError && e.code === "FORBIDDEN" && /admin/.test(e.message));
});

test("rejects values the wire cannot carry before sending", async () => {
  const c = commandClient({});
  const api = createApi(c);
  for (const bad of ["a\nb", "x -&save", "-&flag", "", "   "]) {
    await assert.rejects(api.set("k", bad), (e) => e.code === "EINVAL", JSON.stringify(bad));
  }
  await assert.rejects(api.get("two words"), (e) => e.code === "EINVAL");
  assert.equal(c.lines.length, 0);
});

test("modern client methods are used and their results normalised", async () => {
  const calls = [];
  const client = {
    async command(line) {
      calls.push(["command", line]);
      if (line.startsWith("EXISTS")) return { ok: true, exists: true, cache: true, persistent: false };
      if (line.startsWith("TTL")) return { ok: true, ttl: 5, ttlMillis: 4500 };
      if (line.startsWith("KEYS")) return { ok: true, keys: ["a"], count: 1, truncated: true };
      return { ok: true };
    },
    async info() {
      calls.push(["info"]);
      return { server: { version: "2" } };
    },
    async keys(p, o) {
      calls.push(["keys", p, o]);
      return ["a"];
    },
    async query(sql, params) {
      calls.push(["query", sql, params]);
      if (/^INSERT/.test(sql)) return { columns: [], rows: [], count: 0, affected: 1, lastRowId: 3, message: "1 row inserted" };
      return { columns: ["x"], rows: [[1]], count: 1 };
    },
    async dump() {
      return { ok: true, format: 1, cache: {} };
    },
    async whoami() {
      return { group: "g", admin: true, project: null };
    },
    async get(key) {
      const e = new Error("not found");
      e.code = "NOTFOUND";
      throw e;
    },
    async import(data, o) {
      calls.push(["import", o.replace]);
      o.onProgress({ done: 1, total: 2 });
      return { imported: { persistent: 1, cache: 2, tables: 0, rows: 0 } };
    },
    async use(token) {
      calls.push(["use", token]);
    },
  };
  const api = createApi(client);
  assert.equal(api.modern, true);
  assert.deepEqual(await api.info(), { server: { version: "2" } });
  const k = await api.keys("*", { limit: 1 });
  assert.deepEqual(k, { keys: ["a"], count: 1, truncated: true });
  // KEYS goes through command() on purpose (the client's keys() drops "truncated")
  assert.deepEqual(calls.find((c) => c[0] === "command" && c[1].startsWith("KEYS")), ["command", "KEYS * -&limit=1"]);
  const change = await api.query("INSERT INTO t VALUES (1)");
  assert.equal(change.columns, undefined, "a change is not shown as an empty result set");
  assert.equal(await api.get("zz"), null, "NOTFOUND from a modern client means null");
  assert.deepEqual(await api.dump(), { format: 1, cache: {} });
  const progress = [];
  const imported = await api.import({ cache: {} }, { replace: true, onProgress: (p) => progress.push(p) });
  assert.deepEqual(imported, { persistent: 1, cache: 2, tables: 0, rows: 0 });
  assert.ok(progress.some((p) => p.done === 1 && p.total === 2));
  assert.equal(await api.use("t"), true);
  const [meta] = await api.keyMeta(["a"]);
  assert.deepEqual(meta, { key: "a", exists: true, cache: true, persistent: false, ttl: 5, ttlMillis: 4500 });
});

test("normalizeError maps legacy codes and reply codes", () => {
  const legacy = Object.assign(new Error("login failed"), { code: "EAUTH" });
  assert.equal(normalizeError(legacy).code, "AUTH");
  const server = Object.assign(new Error("x"), { code: "ESERVER", reply: { ok: false, error: "Table not found", code: "SQL" } });
  const e = normalizeError(server);
  assert.equal(e.code, "SQL");
  assert.equal(e.message, "Table not found");
  assert.equal(normalizeError("boom").code, "ERROR");
  assert.equal(isConnectionError({ code: "ECLOSED" }), true);
  assert.equal(isConnectionError({ code: "SQL" }), false);
});

test("chunkDump keeps lines small and tables whole", () => {
  const dump = { cache: {}, persistent: {}, ttl: {}, tables: { t: { columns: [{ name: "id", type: "INTEGER" }], rows: [[1], [2]] } } };
  for (let i = 0; i < 1000; i++) dump.cache[`k${i}`] = "x".repeat(100);
  dump.ttl.k5 = 1000;
  for (let i = 0; i < 10; i++) dump.persistent[`p${i}`] = "y";
  const chunks = chunkDump(dump, { maxBytes: 20000, replace: true });
  assert.ok(chunks.length > 3);
  for (const c of chunks) {
    assert.ok(JSON.stringify(c).length < 25000);
    assert.equal(c.replace, true);
  }
  const cacheKeys = chunks.flatMap((c) => Object.keys(c.cache || {}));
  assert.equal(cacheKeys.length, 1000);
  const withTtl = chunks.find((c) => c.cache && c.cache.k5);
  assert.equal(withTtl.ttl.k5, 1000, "ttl travels with its key");
  const tableChunks = chunks.filter((c) => c.tables);
  assert.equal(tableChunks.length, 1);
  assert.deepEqual(tableChunks[0].tables.t.rows, [[1], [2]]);
  // a big table: created by the first line, continued with append lines (never replace)
  const big = { tables: { big: { columns: [{ name: "v", type: "TEXT" }], indexes: [{ name: "i", column: "v", unique: false }], rows: Array.from({ length: 50 }, (_, i) => [`${i}`.padEnd(100, "x")]) } } };
  const parts = chunkDump(big, { maxBytes: 1200, replace: true });
  assert.ok(parts.length > 3);
  assert.equal(parts[0].replace, true);
  assert.deepEqual(parts[0].tables.big.indexes, big.tables.big.indexes);
  for (const p of parts.slice(1)) {
    assert.equal(p.append, true);
    assert.equal(p.replace, undefined);
  }
  assert.equal(parts.flatMap((p) => p.tables.big.rows).length, 50);
});

test("import fallback sends IMPORT chunks and sums the results", async () => {
  const c = commandClient((line) => {
    if (line.startsWith("IMPORT ")) {
      const d = JSON.parse(line.slice(7));
      return { ok: true, message: "Imported", imported: { persistent: Object.keys(d.persistent || {}).length, cache: Object.keys(d.cache || {}).length, tables: Object.keys(d.tables || {}).length, rows: 0 } };
    }
    return { ok: true };
  });
  const api = createApi(c);
  const progress = [];
  const r = await api.import({ cache: { a: "1", b: "2" }, persistent: { c: "3" }, tables: { t: { columns: [{ name: "id", type: "INTEGER" }], rows: [] } } }, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(r, { persistent: 1, cache: 2, tables: 1, rows: 0 });
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
  assert.ok(c.lines.every((l) => !/[\r\n]/.test(l)));
});

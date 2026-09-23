"use strict";

// An in-process fake Denis server for the unit tests (no real server needed).

const net = require("node:net");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAIN_TOKEN = "main-token";

/**
 * A fake server speaking enough of the JSON-mode protocol (docs/PROTOCOL.md):
 * MODE, LIN, AUTH (CREATE/DELETE), PING, HELLO, HELP, INFO, WHOAMI,
 * GET/SET/UPDATE/DEL/EXISTS/KEYS/MGET/INCR/HEAVEN, IMPORT, a tiny SQL
 * (CREATE TABLE, INSERT with bound params, SELECT, SHOW TABLES, DESCRIBE,
 * DROP TABLE) through `SQL` and `QUERY {"sql","params"}`, the GraphQL-shaped
 * `QUERY { ... }` (echoed back), ADMIN <main-token> ..., plus test commands:
 * ECHO <text>, SPLIT <text> (reply written byte by byte), DELAY <ms> <text>,
 * SLOW (never answers), KILL (drops the socket), FAIL <code>.
 * Lines of one connection are handled strictly one after another, like Denis.
 */
async function fakeServer(options = {}) {
  const users = options.users || { ci: "pass word" };
  const state = {
    projects: new Map([["tok0", new Map()], ["tok1", new Map()]]),
    tables: new Map(), // token -> Map(name -> {columns: [{name, type}], rows: [object]})
    quotas: new Map(),
    created: 0,
    conns: [],
    imports: [],
    refuse: options.refuse || false,
  };

  function tablesOf(token) {
    if (!state.tables.has(token)) state.tables.set(token, new Map());
    return state.tables.get(token);
  }

  function sqlError(message) {
    return { ok: false, error: message, code: "SQL", data: `ERROR: ${message}` };
  }

  function tableInfo(name, table) {
    return { name, columns: table.columns, rows: table.rows.length };
  }

  /** A very small SQL: enough to check reply shapes and wire lines. */
  function runSql(token, sql, params = []) {
    const tables = tablesOf(token);
    const text = sql.replace(/\s+/g, " ").trim().replace(/;$/, "");
    let m;
    if ((m = /^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \((.*)\)$/i.exec(text))) {
      if (tables.has(m[1])) {
        if (/IF NOT EXISTS/i.test(text)) return { ok: true, type: "affected", affected: 0, message: "Table exists", lastRowId: 0, data: "OK: Table exists" };
        return sqlError(`Table already exists: ${m[1]}`);
      }
      const columns = m[2].split(",").map((c) => {
        const [name, type = "TEXT"] = c.trim().split(" ");
        return { name, type: type.toUpperCase() };
      });
      tables.set(m[1], { columns, rows: [] });
      return { ok: true, type: "affected", affected: 0, message: "Table created", lastRowId: 0, data: "OK: Table created" };
    }
    if ((m = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \(([^)]*)\)$/i.exec(text))) {
      const table = tables.get(m[1]);
      if (!table) return sqlError(`Table not found: ${m[1]}`);
      const cols = m[2].split(",").map((c) => c.trim());
      let p = 0;
      const values = m[3].split(",").map((v) => {
        v = v.trim();
        if (v === "?") return params[p++];
        if (/^'.*'$/.test(v)) return v.slice(1, -1);
        return Number(v);
      });
      const row = {};
      for (const c of table.columns) row[c.name] = null;
      cols.forEach((c, i) => (row[c] = values[i]));
      table.rows.push(row);
      return { ok: true, type: "affected", affected: 1, message: "1 row inserted", lastRowId: table.rows.length, data: "OK: 1 row inserted" };
    }
    if ((m = /^SELECT (.+) FROM (\w+)(?: WHERE (\w+) = (\?|\d+|'[^']*'))?$/i.exec(text))) {
      const table = tables.get(m[2]);
      if (!table) return sqlError(`Table not found: ${m[2]}`);
      const columns = m[1] === "*" ? table.columns.map((c) => c.name) : m[1].split(",").map((c) => c.trim());
      let rows = table.rows;
      if (m[3]) {
        const want = m[4] === "?" ? params[0] : /^'/.test(m[4]) ? m[4].slice(1, -1) : Number(m[4]);
        rows = rows.filter((r) => r[m[3]] === want);
      }
      const out = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      return { ok: true, type: "rows", columns, rows: out, count: out.length, data: JSON.stringify(out) };
    }
    if (/^SHOW TABLES$/i.test(text)) {
      const list = [...tables].map(([name, t]) => tableInfo(name, t));
      return { ok: true, type: "tables", tables: list, count: list.length };
    }
    if ((m = /^(?:DESCRIBE|DESC) (\w+)$/i.exec(text))) {
      const table = tables.get(m[1]);
      if (!table) return sqlError(`Table not found: ${m[1]}`);
      return { ok: true, type: "tables", tables: [tableInfo(m[1], table)], count: 1 };
    }
    if ((m = /^DROP TABLE (\w+)$/i.exec(text))) {
      if (!tables.delete(m[1])) return sqlError(`Table not found: ${m[1]}`);
      return { ok: true, type: "affected", affected: 0, message: "Table dropped", lastRowId: 0, data: "OK: Table dropped" };
    }
    return sqlError("Unsupported SQL query");
  }

  function usageOf(token) {
    const store = state.projects.get(token);
    const quota = state.quotas.get(token) || { maxKeys: 0, maxBytes: 0 };
    return {
      token,
      usage: { cachedKeys: store.size, cachedBytes: 0, persistedKeys: 0, persistedBytes: 0 },
      quota,
    };
  }

  function admin(words) {
    if (words[0] !== MAIN_TOKEN) return { ok: false, error: "ADMIN refused: wrong main token", code: "AUTH" };
    const [, sub, token, a, b] = words;
    switch ((sub || "").toUpperCase()) {
      case "LIST":
        return { ok: true, projects: [...state.projects.keys()].map(usageOf), count: state.projects.size };
      case "CREATE": {
        const created = `adm${++state.created}`;
        state.projects.set(created, new Map());
        if (token !== undefined) state.quotas.set(created, { maxKeys: Number(token), maxBytes: Number(a) });
        return { ok: true, message: "Project created", token: created };
      }
      case "IMPORT": {
        const added = !state.projects.has(token);
        if (added) state.projects.set(token, new Map());
        if (a !== undefined) state.quotas.set(token, { maxKeys: Number(a), maxBytes: Number(b) });
        return { ok: true, message: added ? "Project imported" : "Project already known", token, added };
      }
      case "USAGE":
        if (!state.projects.has(token)) return { ok: false, error: `Unknown project: ${token}` };
        return { ok: true, ...usageOf(token) };
      case "QUOTA":
        if (!state.projects.has(token)) return { ok: false, error: `Unknown project: ${token}` };
        state.quotas.set(token, { maxKeys: Number(a), maxBytes: Number(b) });
        return { ok: true, message: "Quota set", ...usageOf(token) };
      case "FLUSH":
        state.projects.get(token).clear();
        return { ok: true, message: "Project flushed" };
      case "DROP":
        state.projects.delete(token);
        return { ok: true, message: "Project dropped" };
      default:
        return { ok: false, error: "USAGE: ADMIN <main-token> LIST|CREATE|IMPORT|USAGE|QUOTA|FLUSH|DROP", code: "USAGE" };
    }
  }

  function handle(conn, line) {
    const space = line.indexOf(" ");
    const cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const args = space < 0 ? "" : line.slice(space + 1);
    const words = args.split(" ");
    switch (cmd) {
      case "MODE":
        return { ok: true, message: "mode json" };
      case "PING":
        return { ok: true, message: "PONG" };
      case "HELLO":
        return { ok: true, server: "denis", version: "1.1.0-fake", protocol: 2, features: ["json", "sql-params", "graph"], loggedIn: conn.loggedIn };
      case "HELP":
        return {
          ok: true,
          commands: [
            { name: "PING", usage: "PING", description: "Liveness check", needsLogin: false, needsProject: false },
            { name: "SQL", usage: "SQL <statement>", description: "Run SQL", needsLogin: true, needsProject: true },
          ],
        };
      case "EXIT":
        return () => conn.socket.end(JSON.stringify({ ok: true, message: "Bye." }) + "\n");
      case "ECHO":
        return { ok: true, data: args };
      case "SPLIT":
        return async () => {
          const bytes = Buffer.from(JSON.stringify({ ok: true, data: args }) + "\n");
          for (const byte of bytes) {
            conn.socket.write(Buffer.from([byte]));
            await sleep(1);
          }
        };
      case "DELAY":
        return sleep(Number(words[0])).then(() => ({ ok: true, data: words.slice(1).join(" ") }));
      case "SLOW":
        return new Promise(() => {});
      case "KILL":
        return () => conn.socket.destroy();
      case "FAIL":
        return { ok: false, error: `failed with ${words[0]}`, code: words[0] };
      case "ADMIN":
        return admin(words);
      case "LIN": {
        const group = words[0];
        const password = args.slice(group.length + 1);
        if (users[group] !== undefined && users[group] === password) {
          conn.loggedIn = true;
          return { ok: true, message: `Logged in to group: ${group}`, group, admin: true };
        }
        return { ok: false, error: "Login failed: unknown group or wrong password", code: "AUTH" };
      }
      default:
        break;
    }
    if (!conn.loggedIn) return { ok: false, error: "Please login first using LIN command", code: "NOAUTH" };
    if (cmd === "AUTH") {
      if (words[0] === "CREATE") {
        const token = `new${++state.created}`;
        state.projects.set(token, new Map());
        return { ok: true, message: "Project created", token };
      }
      if (words[0] === "DELETE") {
        state.projects.delete(words[1]);
        if (conn.token === words[1]) conn.token = null;
        return { ok: true, message: "Project deleted" };
      }
      if (!state.projects.has(words[0])) return { ok: false, error: `Cannot auth with: ${words[0]}`, code: "AUTH" };
      conn.token = words[0];
      return { ok: true, message: `Authenticated to project: ${words[0]}` };
    }
    if (cmd === "WHOAMI") return { ok: true, group: "ci", admin: true, project: conn.token };
    if (cmd === "INFO") {
      const project = conn.token && state.projects.has(conn.token) ? { ...usageOf(conn.token).usage, quota: usageOf(conn.token).quota } : undefined;
      return {
        ok: true,
        version: "1.1.0-fake",
        uptimeSeconds: 5,
        startedAt: "2026-01-01T00:00:00Z",
        connections: { open: state.conns.length, total: state.conns.length },
        commandsTotal: 10,
        cacheKeys: 0,
        persistedKeys: 0,
        projects: state.projects.size,
        group: "ci",
        ...(project ? { project } : {}),
        memory: { usedMb: 1, maxMb: 2 },
        info: { server: { version: "1.1.0-fake", protocol: 2 }, stats: { commands: 10 } },
      };
    }
    const store = state.projects.get(conn.token);
    if (!store) return { ok: false, error: "Please authenticate first using AUTH command", code: "NOPROJECT" };
    const key = words[0];
    switch (cmd) {
      case "SET":
      case "UPDATE": {
        const rest = args.slice(key.length + 1);
        const value = rest.split(" ").filter((w) => !w.startsWith("-&")).join(" ");
        const quota = state.quotas.get(conn.token);
        if (quota && quota.maxKeys && !store.has(key) && store.size >= quota.maxKeys) {
          return { ok: false, error: `quota exceeded: keys (limit ${quota.maxKeys})`, code: "QUOTA", resource: "keys", limit: quota.maxKeys };
        }
        store.set(key, value);
        return { ok: true, message: "Ok (Cache)" };
      }
      case "GET":
        if (key === "__oom") return { ok: false, error: "out of memory", code: "OOM" };
        return store.has(key) ? { ok: true, key, data: store.get(key) } : { ok: false, key, error: "not found", code: "NOTFOUND" };
      case "DEL": {
        const existed = store.delete(key);
        return { ok: true, message: "Ok (Cache,Protobuf).", deleted: existed };
      }
      case "EXISTS":
        return { ok: true, key, exists: store.has(key), cache: store.has(key), persistent: false };
      case "KEYS": {
        const re = new RegExp(`^${key.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
        const keys = [...store.keys()].filter((k) => re.test(k)).sort();
        return { ok: true, keys, count: keys.length, truncated: false };
      }
      case "MGET": {
        const values = Object.fromEntries(words.map((k) => [k, store.has(k) ? store.get(k) : null]));
        return { ok: true, data: values, values };
      }
      case "HEAVEN": {
        const removed = store.size;
        store.clear();
        return { ok: true, message: "Ok.", removed };
      }
      case "INCR": {
        const value = Number(store.get(key) || 0) + (words[1] && !words[1].startsWith("-&") ? Number(words[1]) : 1);
        store.set(key, String(value));
        return { ok: true, key, data: String(value), value };
      }
      case "SAVE":
        return { ok: true, message: "Snapshot written", bytes: 1, records: 1, millis: 1 };
      case "SQL":
        return runSql(conn.token, args);
      case "QUERY": {
        let bound = null;
        if (args.startsWith("{\"")) {
          try {
            bound = JSON.parse(args);
          } catch {
            bound = null;
          }
        }
        if (bound && typeof bound.sql === "string") return runSql(conn.token, bound.sql, bound.params || []);
        if (!args.startsWith("{")) return { ok: false, error: "syntax: expected {", offset: 0 };
        return { ok: true, data: { document: args }, errors: [{ path: "bad", error: "unknown resolver" }] };
      }
      case "IMPORT": {
        const data = JSON.parse(args);
        state.imports.push({ line, data });
        const tables = Object.values(data.tables || {});
        return {
          ok: true,
          message: "Imported",
          imported: {
            persistent: Object.keys(data.persistent || {}).length,
            cache: Object.keys(data.cache || {}).length,
            tables: tables.length,
            rows: tables.reduce((n, t) => n + (t.rows || []).length, 0),
          },
        };
      }
      default:
        return { ok: false, error: `Unknown command: ${cmd} (try HELP)`, code: "UNKNOWN" };
    }
  }

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setNoDelay(true);
    if (state.refuse) {
      socket.end(JSON.stringify({ ok: false, error: "max number of clients reached", code: "LIMIT" }) + "\n");
      return;
    }
    const conn = { socket, lines: [], loggedIn: false, token: null, outstanding: 0, maxOutstanding: 0 };
    state.conns.push(conn);
    let buffer = Buffer.alloc(0);
    let chain = Promise.resolve();
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let index;
      while ((index = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, index).toString("utf8").replace(/\r$/, "").trim();
        buffer = buffer.subarray(index + 1);
        if (!line) continue;
        conn.lines.push(line);
        conn.outstanding++;
        conn.maxOutstanding = Math.max(conn.maxOutstanding, conn.outstanding);
        chain = chain
          .then(() => handle(conn, line))
          .then(async (reply) => {
            conn.outstanding--;
            if (socket.destroyed) return;
            if (typeof reply === "function") await reply();
            else socket.write(JSON.stringify(reply) + "\n");
          });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.server = server;
  /** Every line received on any connection. */
  state.allLines = () => state.conns.flatMap((c) => c.lines);
  /** Drop every client connection (the server keeps listening). */
  state.kill = () => {
    for (const socket of sockets) socket.destroy();
  };
  /** Stop listening and drop every connection. */
  state.close = () =>
    new Promise((resolve) => {
      state.kill();
      server.close(() => resolve());
    });
  return state;
}

module.exports = { fakeServer, sleep, MAIN_TOKEN };

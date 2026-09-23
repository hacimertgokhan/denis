"use strict";

/**
 * A small in-process TCP server that speaks enough of the Denis protocol
 * (docs/PROTOCOL.md) for connection-manager tests: MODE, HELLO, PING, LIN,
 * WHOAMI, AUTH (token / CREATE / DELETE), PROJECTS, INFO, KEYS, EXISTS, TTL,
 * GET, SET, DEL, INCR, EXPIRE, PERSIST, DBSIZE, SQL, QUERY, DUMP, IMPORT, EXIT.
 * SQL replies have the shape of the merged server (docs/PROTOCOL.md):
 * {type:"rows", columns, rows:[{col: value}]}, {type:"affected", ...},
 * {type:"tables", tables:[{name, columns, rows, indexes, bytes}]}; INFO has the
 * top-level statistics and the detailed sections under "info".
 *
 * It can be stopped and restarted on the same port to simulate a server
 * restart. `lines` records every received line (for assertions).
 */

const net = require("node:net");

class FakeDenis {
  constructor({ groups = { studio: { password: "pw", admin: true }, user: { password: "u", admin: false } }, version = "0.1.0-fake" } = {}) {
    this.groups = groups;
    this.version = version;
    this.server = null;
    this.port = 0;
    this.sockets = new Set();
    this.projects = new Map([["tok1", { owner: "studio", keys: new Map(), tables: {} }]]);
    this.lines = [];
    this.nextToken = 2;
  }

  async start(port = 0) {
    this.server = net.createServer((socket) => this._onConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port || this.port || 0, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
  }

  _onConnection(socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    const session = { json: false, group: null, admin: false, token: null };
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "").trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        this.lines.push(line);
        const reply = this._handle(session, line);
        if (reply === null) continue;
        socket.write(JSON.stringify(reply) + "\n");
        if (reply.__close) socket.end();
      }
    });
  }

  _handle(s, line) {
    const space = line.indexOf(" ");
    const cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const args = space < 0 ? "" : line.slice(space + 1);
    const ok = (o = {}) => ({ ok: true, ...o });
    const err = (code, error) => ({ ok: false, error, code });
    switch (cmd) {
      case "MODE":
        s.json = /json/i.test(args);
        return ok({ message: `mode ${s.json ? "json" : "text"}` });
      case "PING":
        return ok({ message: "PONG" });
      case "HELLO":
        return ok({ server: "denis", version: this.version, protocol: 2, features: ["json", "sql"], loggedIn: !!s.group });
      case "EXIT":
      case "QUIT":
        return { ok: true, message: "Bye.", __close: true };
      case "LIN": {
        const sp = args.indexOf(" ");
        const g = sp < 0 ? args : args.slice(0, sp);
        const pw = sp < 0 ? "" : args.slice(sp + 1);
        const group = this.groups[g];
        if (!group || group.password !== pw) return err("AUTH", "Login failed: unknown group or wrong password");
        s.group = g;
        s.admin = !!group.admin;
        return ok({ message: `Logged in to group: ${g}`, group: g, admin: s.admin });
      }
      default:
        break;
    }
    if (!s.group) return err("NOAUTH", "Please login first using LIN command");
    const project = s.token ? this.projects.get(s.token) : null;
    switch (cmd) {
      case "WHOAMI":
        return ok({ group: s.group, admin: s.admin, project: s.token });
      case "AUTH": {
        const [sub, rest] = args.split(" ");
        if (/^create$/i.test(sub)) {
          const token = `tok${this.nextToken++}`;
          this.projects.set(token, { owner: s.group, keys: new Map(), tables: {} });
          return ok({ message: "Project created", token });
        }
        if (/^delete$/i.test(sub)) {
          if (!this.projects.has(rest)) return err("AUTH", `Cannot delete project: ${rest}`);
          this.projects.delete(rest);
          if (s.token === rest) s.token = null;
          return ok({ message: "Project deleted" });
        }
        if (!this.projects.has(sub)) return err("AUTH", `Cannot auth with: ${sub}`);
        s.token = sub;
        return ok({ message: `Authenticated to project: ${sub}` });
      }
      case "PROJECTS":
        return ok({
          projects: [...this.projects.entries()].map(([token, p]) => ({ token, owner: p.owner, keys: p.keys.size, tables: Object.keys(p.tables).length, current: token === s.token })),
          count: this.projects.size,
        });
      case "INFO":
        return ok({ version: this.version, uptimeSeconds: 5, connections: { open: this.sockets.size, total: this.sockets.size }, commandsTotal: this.lines.length, info: { server: { version: this.version, protocol: 2, uptimeSeconds: 5 }, clients: { connected: this.sockets.size }, stats: { opsPerSecond: 3, commands: this.lines.length }, memory: { usedBytes: 100, maxBytes: 0 }, persistence: { healthy: true, fsync: "everysec" }, keyspace: { keys: 0 } } });
      case "SAVE":
      case "BACKUP":
      case "BACKUPS":
        if (!s.admin) return err("FORBIDDEN", "This command needs an admin group");
        if (cmd === "BACKUPS") return ok({ backups: [{ name: "b1.zip", path: "data/b1.zip", bytes: 10, createdAt: "2026-01-01T00:00:00Z" }], directory: "data" });
        if (cmd === "BACKUP") return ok({ message: "Backup created", name: "b2.zip", path: "data/b2.zip", bytes: 12, createdAt: "2026-01-01T00:00:00Z" });
        return ok({ message: "Snapshot written", bytes: 1, records: 1, millis: 1 });
      default:
        break;
    }
    if (!project) return err("NOPROJECT", "Please authenticate first using AUTH command");
    const words = args.split(" ");
    const key = words[0];
    switch (cmd) {
      case "SET": {
        const rest = args.slice(key.length + 1).split(" ");
        const flags = rest.filter((w) => w.startsWith("-&"));
        const value = rest.filter((w) => !w.startsWith("-&")).join(" ");
        const slot = project.keys.get(key) || { cache: null, persistent: null, ttl: -1 };
        slot.cache = value;
        if (flags.some((f) => /^-&(save|protobuff)$/i.test(f))) slot.persistent = value;
        const ttl = flags.find((f) => f.startsWith("-&ttl="));
        slot.ttl = ttl ? Number(ttl.slice(6)) : -1;
        project.keys.set(key, slot);
        return ok({ message: "Ok (Cache)" });
      }
      case "GET": {
        const slot = project.keys.get(key);
        const fromDurable = /-&from-protobuff/.test(args);
        const v = slot ? (fromDurable ? slot.persistent ?? slot.cache : slot.cache ?? slot.persistent) : null;
        if (v === null || v === undefined) return { ok: false, key, error: "not found", code: "NOTFOUND" };
        return ok({ key, data: v });
      }
      case "EXISTS": {
        const slot = project.keys.get(key);
        return ok({ key, exists: !!slot, cache: !!(slot && slot.cache !== null), persistent: !!(slot && slot.persistent !== null) });
      }
      case "TTL": {
        const slot = project.keys.get(key);
        const ttl = !slot || slot.cache === null ? -2 : slot.ttl;
        return ok({ key, data: String(ttl), ttl, ttlMillis: ttl > 0 ? ttl * 1000 : ttl });
      }
      case "DEL": {
        const existed = project.keys.delete(key);
        return ok({ message: "Ok (Cache,Protobuf).", deleted: existed });
      }
      case "KEYS": {
        const limitFlag = words.find((w) => w.startsWith("-&limit="));
        const limit = limitFlag ? Number(limitFlag.slice(8)) : 1000;
        const pattern = words.find((w) => w && !w.startsWith("-&")) || "*";
        const re = new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
        const all = [...project.keys.keys()].filter((k) => re.test(k));
        return ok({ keys: all.slice(0, limit), count: Math.min(all.length, limit), truncated: all.length > limit });
      }
      case "INCR": {
        const slot = project.keys.get(key) || { cache: "0", persistent: null, ttl: -1 };
        const delta = words[1] && !words[1].startsWith("-&") ? Number(words[1]) : 1;
        if (!/^-?\d+$/.test(slot.cache ?? slot.persistent ?? "0")) return err("TYPE", `value of ${key} is not an integer`);
        const value = Number(slot.cache ?? slot.persistent ?? 0) + delta;
        slot.cache = String(value);
        project.keys.set(key, slot);
        return ok({ key, data: String(value), value });
      }
      case "EXPIRE":
      case "PERSIST": {
        const slot = project.keys.get(key);
        if (!slot || slot.cache === null) return ok({ key, data: "0", updated: false });
        slot.ttl = cmd === "PERSIST" ? -1 : Number(words[1]);
        return ok({ key, data: "1", updated: true });
      }
      case "DBSIZE":
        return ok({ keys: project.keys.size, cache: project.keys.size, persistent: 0, tables: 0, data: String(project.keys.size) });
      case "HEAVEN":
        for (const [k, slot] of project.keys) {
          if (slot.persistent === null) project.keys.delete(k);
          else slot.cache = null;
        }
        return ok({ message: "Ok." });
      case "SQL":
        return this._sql(project, args, []);
      case "QUERY": {
        const q = JSON.parse(args);
        return this._sql(project, q.sql, q.params || []);
      }
      case "DUMP": {
        const cache = {};
        const persistent = {};
        for (const [k, slot] of project.keys) {
          if (slot.cache !== null) cache[k] = slot.cache;
          if (slot.persistent !== null) persistent[k] = slot.persistent;
        }
        return ok({ format: 1, server: "denis", version: this.version, createdAt: "2026-01-01T00:00:00Z", cache, persistent, ttl: {}, tables: project.tables });
      }
      case "IMPORT": {
        const data = JSON.parse(args);
        let cacheN = 0;
        let persistentN = 0;
        let rows = 0;
        for (const [k, v] of Object.entries(data.persistent || {})) {
          const slot = project.keys.get(k) || { cache: null, persistent: null, ttl: -1 };
          slot.persistent = v;
          project.keys.set(k, slot);
          persistentN++;
        }
        for (const [k, v] of Object.entries(data.cache || {})) {
          const slot = project.keys.get(k) || { cache: null, persistent: null, ttl: -1 };
          slot.cache = v;
          project.keys.set(k, slot);
          cacheN++;
        }
        let tables = 0;
        for (const [name, def] of Object.entries(data.tables || {})) {
          if (project.tables[name] && !data.replace) return { ok: false, error: `Table already exists: ${name} (import with replace to overwrite)`, code: "SQL" };
          project.tables[name] = def;
          rows += (def.rows || []).length;
          tables++;
        }
        return ok({ message: "Imported", imported: { persistent: persistentN, cache: cacheN, tables, rows } });
      }
      default:
        return err("UNKNOWN", `Unknown command: ${cmd}`);
    }
  }
}

/** Table info as SHOW TABLES / DESCRIBE report it. */
function tableInfo(name, def) {
  return { name, columns: def.columns || [], rows: (def.rows || []).length, indexes: def.indexes || [], bytes: JSON.stringify(def.rows || []).length };
}

FakeDenis.prototype._sql = function (project, sql, params) {
  const ok = (o = {}) => ({ ok: true, ...o });
  const text = String(sql).trim();
  if (/^select/i.test(text)) {
    const rows = [{ name: params[0] !== undefined ? params[0] : "Ada", id: 1 }];
    return ok({ type: "rows", columns: ["id", "name"], rows, count: 1, data: JSON.stringify(rows) });
  }
  if (/^show tables/i.test(text)) {
    const tables = Object.entries(project.tables).map(([name, def]) => tableInfo(name, def));
    return ok({ type: "tables", tables, count: tables.length });
  }
  const describe = /^(?:describe|desc)s+(w+)/i.exec(text);
  if (describe) {
    const def = project.tables[describe[1]];
    if (!def) return { ok: false, error: `Table not found: ${describe[1]}`, code: "SQL", data: `ERROR: Table not found: ${describe[1]}` };
    return ok({ type: "tables", tables: [tableInfo(describe[1], def)], count: 1 });
  }
  if (/^bad/i.test(text)) return { ok: false, error: "Syntax error", code: "SQL", data: "ERROR: Syntax error" };
  return ok({ type: "affected", message: "1 row inserted", affected: 1, lastRowId: 7, data: "OK: 1 row inserted" });
};

module.exports = { FakeDenis };

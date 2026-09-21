"use strict";

/**
 * Node.js client for Denis Database.
 *
 * Denis speaks a line protocol over TCP. Every connection first switches the
 * server to `MODE json` so each command is answered with exactly one JSON
 * object per line, then logs in (`LIN`) and selects a project (`AUTH`).
 * Commands on one connection are answered in order, so a connection keeps a
 * FIFO of pending promises; the client keeps a small pool of such connections.
 *
 *   const { DenisClient } = require("denis-client");
 *   const denis = new DenisClient({ host, port, group, password, token });
 *   await denis.set("greeting", "hello world", { persist: true });
 *   await denis.get("greeting");            // "hello world"
 *   await denis.close();
 */

const net = require("node:net");

class DenisError extends Error {
  /**
   * @param {string} message
   * @param {string} code  ECONN | ETIMEOUT | EAUTH | EPROTO | ESERVER | ECLOSED | EINVAL
   * @param {object} [reply] the server's JSON reply, when there was one
   */
  constructor(message, code, reply) {
    super(message);
    this.name = "DenisError";
    this.code = code;
    if (reply) this.reply = reply;
  }
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 5142,
  group: undefined,
  password: undefined,
  token: undefined,
  // create a project with AUTH CREATE when no token is given
  createProject: false,
  poolSize: 4,
  connectTimeout: 5000,
  commandTimeout: 10000,
};

/** Keys are one word on the wire; values may contain spaces but never a line break. */
function assertKey(key) {
  if (typeof key !== "string" || key.length === 0 || /\s/.test(key)) {
    throw new DenisError(`key must be a non-empty string without whitespace: ${JSON.stringify(key)}`, "EINVAL");
  }
}

function encodeValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) {
    throw new DenisError("value is not serialisable", "EINVAL");
  }
  if (/[\r\n]/.test(text)) {
    throw new DenisError("value must not contain line breaks", "EINVAL");
  }
  // a word starting with -& would be read as a flag by the server
  if (/(^|\s)-&/.test(text)) {
    throw new DenisError("value must not contain a word starting with -&", "EINVAL");
  }
  return text;
}

/** One TCP session: framing, ordered request/reply, handshake. */
class DenisConnection {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.buffer = "";
    this.pending = []; // { resolve, reject, timer }
    this.closed = false;
    this.token = options.token;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.options.host, port: this.options.port });
      socket.setNoDelay(true);
      socket.setEncoding("utf8");
      const timer = setTimeout(() => {
        socket.destroy(new DenisError(`connect timeout after ${this.options.connectTimeout} ms`, "ETIMEOUT"));
      }, this.options.connectTimeout);

      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        if (!this.socket) {
          reject(err instanceof DenisError ? err : new DenisError(err.message, "ECONN"));
        }
        this._fail(err instanceof DenisError ? err : new DenisError(err.message, "ECONN"));
      });
      socket.on("data", (chunk) => this._onData(chunk));
      socket.on("close", () => {
        this.closed = true;
        this._fail(new DenisError("connection closed", "ECLOSED"));
      });
    });
  }

  /** MODE json, LIN, AUTH — the part every connection of the pool repeats. */
  async handshake() {
    const mode = await this.raw("MODE json");
    if (!mode.ok) throw new DenisError("server refused MODE json (old server?)", "EPROTO", mode);

    if (this.options.group !== undefined) {
      const login = await this.raw(`LIN ${this.options.group} ${this.options.password ?? ""}`);
      if (!login.ok) throw new DenisError(login.error || "login failed", "EAUTH", login);
    }

    if (this.token) {
      const auth = await this.raw(`AUTH ${this.token}`);
      if (!auth.ok) throw new DenisError(auth.error || "auth failed", "EAUTH", auth);
    } else if (this.options.createProject) {
      const created = await this.raw("AUTH CREATE");
      if (!created.ok || !created.token) throw new DenisError(created.error || "AUTH CREATE failed", "EAUTH", created);
      this.token = created.token;
      const auth = await this.raw(`AUTH ${this.token}`);
      if (!auth.ok) throw new DenisError(auth.error || "auth failed", "EAUTH", auth);
    }
  }

  _onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line.length === 0) continue;
      const waiter = this.pending.shift();
      if (!waiter) continue; // unsolicited line (e.g. a welcome banner)
      clearTimeout(waiter.timer);
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        // text-mode line before MODE json took effect, or a server without json mode
        reply = { ok: !/^\[Error|^err:|^ERROR|^USAGE/.test(line), raw: line };
        if (reply.ok) reply.message = line;
        else reply.error = line;
      }
      waiter.resolve(reply);
    }
  }

  _fail(err) {
    const waiting = this.pending;
    this.pending = [];
    for (const waiter of waiting) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  /** Send one line, resolve with the parsed reply object (never throws on ok:false). */
  raw(line) {
    if (this.closed || !this.socket) {
      return Promise.reject(new DenisError("connection is closed", "ECLOSED"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new DenisError(`no reply within ${this.options.commandTimeout} ms for: ${line.split(" ")[0]}`, "ETIMEOUT");
        this.socket.destroy(err);
      }, this.options.commandTimeout);
      this.pending.push({ resolve, reject, timer });
      this.socket.write(line + "\n");
    });
  }

  destroy() {
    this.closed = true;
    if (this.socket) this.socket.destroy();
  }
}

/** A pool of authenticated connections with the key-value / SQL API on top. */
class DenisClient {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    if (this.options.poolSize < 1) throw new DenisError("poolSize must be >= 1", "EINVAL");
    this.idle = [];
    this.size = 0;
    this.waiters = [];
    this.closing = false;
    // the project token, once known (given, or created by the first connection)
    this.token = this.options.token;
  }

  async _create() {
    this.size++;
    const conn = new DenisConnection({ ...this.options, token: this.token });
    try {
      await conn.connect();
      await conn.handshake();
    } catch (err) {
      this.size--;
      conn.destroy();
      throw err;
    }
    if (!this.token && conn.token) this.token = conn.token;
    return conn;
  }

  async _acquire() {
    if (this.closing) throw new DenisError("client is closed", "ECLOSED");
    while (this.idle.length > 0) {
      const conn = this.idle.pop();
      if (!conn.closed) return conn;
      this.size--;
    }
    if (this.size < this.options.poolSize) {
      return this._create();
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  _release(conn) {
    if (conn.closed) {
      this.size--;
      // somebody may be waiting for a slot that just freed up
      const waiter = this.waiters.shift();
      if (waiter) this._create().then(waiter.resolve, waiter.reject);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(conn);
    else this.idle.push(conn);
  }

  /** Run one command on a pooled connection and return the parsed reply. */
  async command(line) {
    const conn = await this._acquire();
    try {
      return await conn.raw(line);
    } finally {
      this._release(conn);
    }
  }

  async _expectOk(line) {
    const reply = await this.command(line);
    if (!reply.ok) throw new DenisError(reply.error || "command failed", "ESERVER", reply);
    return reply;
  }

  /** Open the pool eagerly (optional; commands connect on demand). */
  async connect() {
    const conn = await this._acquire();
    this._release(conn);
    return this;
  }

  async ping() {
    const reply = await this.command("PING");
    return reply.ok === true;
  }

  /**
   * @param {string} key
   * @param {{source?: "cache"|"protobuf"}} [opts]
   * @returns {Promise<string|null>} the value, or null when the key does not exist
   */
  async get(key, opts = {}) {
    assertKey(key);
    const flag = opts.source === "protobuf" ? " -&from-protobuff" : opts.source === "cache" ? " -&from-cache" : "";
    const reply = await this.command(`GET ${key}${flag}`);
    if (reply.ok) return reply.data ?? null;
    if (reply.error === "not found") return null;
    throw new DenisError(reply.error, "ESERVER", reply);
  }

  /** get() and JSON.parse the value; null when missing. */
  async getJSON(key, opts) {
    const value = await this.get(key, opts);
    return value === null ? null : JSON.parse(value);
  }

  /**
   * @param {string} key
   * @param {string|object} value  non-strings are JSON.stringify-ed
   * @param {{persist?: boolean}} [opts] persist=true also writes the protobuf file (-&save)
   */
  async set(key, value, opts = {}) {
    assertKey(key);
    const flags = opts.persist ? " -&cache -&save" : "";
    await this._expectOk(`SET ${key} ${encodeValue(value)}${flags}`);
    return true;
  }

  /** Cache-only overwrite (UPDATE). */
  async update(key, value) {
    assertKey(key);
    await this._expectOk(`UPDATE ${key} ${encodeValue(value)}`);
    return true;
  }

  /**
   * @param {string} key
   * @param {{cache?: boolean, protobuf?: boolean}} [opts] default: both
   */
  async del(key, opts = {}) {
    assertKey(key);
    const flag = opts.cache && !opts.protobuf ? " -&cache" : opts.protobuf && !opts.cache ? " -&protobuff" : "";
    await this._expectOk(`DEL ${key}${flag}`);
    return true;
  }

  /** Drop every cached key of the current project (HEAVEN). */
  async clear() {
    await this._expectOk("HEAVEN");
    return true;
  }

  /** EXISTS: whether the key is in the cache or the persisted store. */
  async exists(key) {
    assertKey(key);
    const reply = await this._expectOk(`EXISTS ${key}`);
    return reply.exists === true;
  }

  /** KEYS [pattern]: the project's keys; pattern supports * and ? (default "*"). */
  async keys(pattern = "*") {
    if (/\s/.test(pattern)) throw new DenisError("pattern must not contain whitespace", "EINVAL");
    const reply = await this._expectOk(`KEYS ${pattern}`);
    return reply.keys;
  }

  /** MGET: read several keys at once; missing keys map to null. */
  async mget(keys) {
    if (!Array.isArray(keys) || keys.length === 0) throw new DenisError("keys must be a non-empty array", "EINVAL");
    keys.forEach(assertKey);
    const reply = await this._expectOk(`MGET ${keys.join(" ")}`);
    return reply.values;
  }

  /** INFO: server statistics (version, uptime, connections, key counts). */
  async info() {
    const { ok, ...info } = await this._expectOk("INFO");
    return info;
  }

  /** SAVE: flush the persisted store to disk now. */
  async save() {
    await this._expectOk("SAVE");
    return true;
  }

  /** HELP: the server's command reference. */
  async help() {
    const reply = await this._expectOk("HELP");
    return reply.commands;
  }

  /**
   * Run a Denis SQL statement and return the structured result:
   *   { type: "rows", columns, rows, count }
   *   { type: "affected", affected, message }
   *   { type: "tables", tables, count }
   * Errors (`ok:false`) are thrown as DenisError with code ESERVER.
   */
  async sql(query) {
    if (/[\r\n]/.test(query)) throw new DenisError("query must be a single line", "EINVAL");
    const { ok, ...result } = await this._expectOk(`SQL ${query}`);
    return result;
  }

  /** sql() for SELECT: resolves with the row objects. */
  async query(sql) {
    const result = await this.sql(sql);
    if (result.type !== "rows") throw new DenisError(`expected rows, got ${result.type}`, "EPROTO", result);
    return result.rows;
  }

  /** sql() for INSERT/UPDATE/DELETE/DDL: resolves with the affected row count. */
  async execute(sql) {
    const result = await this.sql(sql);
    if (result.type !== "affected") throw new DenisError(`expected an affected count, got ${result.type}`, "EPROTO", result);
    return result.affected;
  }

  /** SHOW TABLES: [{ name, columns: [{name, type}], rows }] */
  async tables() {
    const result = await this.sql("SHOW TABLES");
    return result.tables;
  }

  /** DESCRIBE <table>: { name, columns, rows } or null when the table does not exist. */
  async describe(table) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new DenisError("invalid table name", "EINVAL");
    try {
      const result = await this.sql(`DESCRIBE ${table}`);
      return result.tables[0];
    } catch (err) {
      if (err.code === "ESERVER" && /not found/i.test(err.message)) return null;
      throw err;
    }
  }

  /** Create a new project token on the server (does not switch this client to it). */
  async createProject() {
    const reply = await this._expectOk("AUTH CREATE");
    return reply.token;
  }

  /** Close every connection; pending waiters are rejected. */
  async close() {
    this.closing = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new DenisError("client is closed", "ECLOSED"));
    }
    for (const conn of this.idle.splice(0)) {
      try {
        await conn.raw("EXIT").catch(() => {});
      } finally {
        conn.destroy();
      }
    }
    this.size = 0;
  }
}

module.exports = { DenisClient, DenisConnection, DenisError };

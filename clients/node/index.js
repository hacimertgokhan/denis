"use strict";

/**
 * Node.js client for Denis Database (wire protocol version 2, see docs/PROTOCOL.md).
 *
 * Denis speaks a line protocol over TCP and answers every command line with
 * exactly one reply line, in order. Every connection first switches to
 * `MODE json` (one JSON object per reply), logs in (`LIN`) and selects a
 * project (`AUTH`); the three lines are sent in one write.
 *
 * Because replies arrive in order, a connection does not need to wait for a
 * reply before sending the next command: each connection keeps a FIFO of
 * pending replies and commands are written as soon as they are issued
 * (pipelining). The client keeps a small pool of such connections and sends
 * each command to the least loaded one. Commands issued in the same tick are
 * coalesced into one socket write.
 *
 *   const { DenisClient } = require("denis-client");
 *   const denis = new DenisClient({ host, port, group, password, token });
 *   await denis.set("greeting", "hello world", { persist: true });
 *   await denis.get("greeting");            // "hello world"
 *   await denis.close();
 */

const net = require("node:net");
const { EventEmitter } = require("node:events");

class DenisError extends Error {
  /**
   * @param {string} message
   * @param {string} code  the server's `code` (NOTFOUND, AUTH, SQL, OOM, BUSY, ...) or a client code:
   *                       ECONN | ETIMEOUT | ECLOSED | EINVAL | EPROTO | ESERVER (server error without a code)
   * @param {object} [reply] the server's JSON reply, when there was one
   */
  constructor(message, code, reply) {
    super(message);
    this.name = "DenisError";
    this.code = code;
    if (reply) this.reply = reply;
  }
}

const RECONNECT_DEFAULTS = { retries: 5, minDelay: 100, maxDelay: 5000 };

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
  reconnect: RECONNECT_DEFAULTS,
  // commands in flight per connection before new ones wait in the client queue
  maxPending: 10000,
  // import() splits a dump into several IMPORT lines above this size (the server's max-line-size is 8 MB)
  importChunkBytes: 1024 * 1024,
};

// ======================================================================= helpers

/** Keys are one word on the wire. */
function assertKey(key) {
  if (typeof key !== "string" || key.length === 0 || /\s/.test(key)) {
    throw new DenisError(`key must be a non-empty string without whitespace: ${JSON.stringify(key)}`, "EINVAL");
  }
}

function assertWord(value, what) {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
    throw new DenisError(`${what} must be a non-empty string without whitespace`, "EINVAL");
  }
}

/** Values may contain spaces but never a line break, and no word may start with -& (the flag marker). */
function encodeValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) {
    throw new DenisError("value is not serialisable", "EINVAL");
  }
  if (/[\r\n]/.test(text)) {
    throw new DenisError("value must not contain line breaks", "EINVAL");
  }
  if (/(^|\s)-&/.test(text)) {
    throw new DenisError("value must not contain a word starting with -&", "EINVAL");
  }
  return text;
}

/**
 * Servers before 0.1.0 trimmed every command line, so a value ending in
 * whitespace (or an empty value) only survived when a flag followed it; 0.1.0
 * keeps trailing whitespace. The no-op flag `-&cache` (SET always writes the
 * cache value) keeps such values intact on every server version.
 */
function needsGuardFlag(text) {
  return text.length === 0 || /\s$/.test(text);
}

function assertLine(line) {
  if (typeof line !== "string" || line.trim().length === 0 || /[\r\n]/.test(line)) {
    throw new DenisError("command must be a non-empty single line", "EINVAL");
  }
}

function assertPositive(n, what) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new DenisError(`${what} must be a positive number`, "EINVAL");
  }
}

function replyError(reply, fallback) {
  return new DenisError(reply.error || fallback || "command failed", reply.code || "ESERVER", reply);
}

function expectOk(reply) {
  if (!reply.ok) throw replyError(reply);
  return reply;
}

/** The reply without its `ok` field. */
function strip(reply) {
  expectOk(reply);
  const { ok, ...rest } = reply; // eslint-disable-line no-unused-vars
  return rest;
}

function parseReply(line) {
  if (line.charCodeAt(0) === 123 /* { */) {
    try {
      return JSON.parse(line);
    } catch {
      // fall through to the text-mode heuristics
    }
  }
  // a text-mode line (a server that ignored MODE json, or before it took effect)
  const ok = !/^\[Error|^err:|^ERROR|^USAGE/.test(line);
  return ok ? { ok, raw: line, message: line } : { ok, raw: line, error: line };
}

function jsonReplacer(key, value) {
  return typeof value === "bigint" ? (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()) : value;
}

function deadlineOf(timeout) {
  return timeout > 0 && Number.isFinite(timeout) ? Date.now() + timeout : 0;
}

function sqlResult(reply) {
  expectOk(reply);
  const rows = reply.rows || [];
  return {
    columns: reply.columns || [],
    rows,
    count: reply.count ?? rows.length,
    affected: reply.affected ?? 0,
    lastRowId: reply.lastRowId ?? null,
    message: reply.message ?? null,
  };
}

function rowsToObjects(result) {
  const { columns, rows } = result;
  return rows.map((row) => {
    const object = {};
    for (let i = 0; i < columns.length; i++) object[columns[i]] = row[i];
    return object;
  });
}

/** Array-backed queue with O(1) shift. */
class Fifo {
  constructor() {
    this._items = [];
    this._head = 0;
  }

  get length() {
    return this._items.length - this._head;
  }

  push(value) {
    this._items.push(value);
  }

  peek() {
    return this._items[this._head];
  }

  shift() {
    if (this._head >= this._items.length) return undefined;
    const value = this._items[this._head];
    this._items[this._head++] = undefined;
    if (this._head === this._items.length) {
      this._items.length = 0;
      this._head = 0;
    } else if (this._head > 1024 && this._head * 2 > this._items.length) {
      this._items = this._items.slice(this._head);
      this._head = 0;
    }
    return value;
  }

  /** Remove and return everything. */
  clear() {
    const all = this._items.slice(this._head);
    this._items = [];
    this._head = 0;
    return all;
  }

  *[Symbol.iterator]() {
    for (let i = this._head; i < this._items.length; i++) yield this._items[i];
  }
}

/** One timer armed at the earliest deadline of a queue, instead of one timer per command. */
class DeadlineTimer {
  constructor(onFire) {
    this._onFire = onFire;
    this._handle = null;
    this._at = 0;
  }

  arm(deadline) {
    if (!deadline) return;
    if (this._handle !== null && this._at <= deadline) return;
    if (this._handle !== null) clearTimeout(this._handle);
    this._at = deadline;
    const delay = Math.min(Math.max(0, deadline - Date.now()), 2147483647);
    this._handle = setTimeout(() => {
      this._handle = null;
      this._onFire();
    }, delay);
  }

  clear() {
    if (this._handle !== null) {
      clearTimeout(this._handle);
      this._handle = null;
    }
  }
}

/** Earliest deadline among queued entries, and the first one that has passed. */
function scanDeadlines(queue, now) {
  let min = 0;
  for (const entry of queue) {
    const deadline = entry.deadline;
    if (!deadline || entry.done) continue;
    if (deadline <= now) return { expired: entry, min: 0 };
    if (min === 0 || deadline < min) min = deadline;
  }
  return { expired: null, min };
}

function failUnit(unit, err) {
  unit.done = true;
  if (unit.batch) {
    for (const req of unit.batch) req.reject(err);
  } else {
    unit.reject(err);
  }
}

// ======================================================================= connection

/**
 * One TCP session: byte-safe line framing, a FIFO of pending replies,
 * coalesced writes, per-command deadlines and the MODE/LIN/AUTH handshake.
 *
 * Emits "close" (error|null) once the socket is gone; every command that was
 * still waiting for its reply is rejected with ECLOSED (or ETIMEOUT for the
 * command whose deadline passed).
 */
class DenisConnection extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
    this.socket = null;
    this.pending = new Fifo(); // requests waiting for their reply, in send order
    this.closed = false;
    this.ready = false; // handshake done
    this.retiring = false; // no new commands (EXIT sent or about to be)
    this.token = this.options.token;
    this._partial = []; // Buffers of an incomplete reply line
    this._out = "";
    this._flushScheduled = false;
    this._flush = this._flush.bind(this);
    this._timer = new DeadlineTimer(() => this._checkDeadlines());
    this._timedOut = null;
    this._closeError = null;
    this._onReply = typeof options.onReply === "function" ? options.onReply : null;
  }

  /** Open the TCP connection. */
  connect() {
    if (this.socket || this.closed) {
      return Promise.reject(new DenisError("connect() may only be called once per connection", "EINVAL"));
    }
    const { host, port, connectTimeout } = this.options;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const socket = net.createConnection({ host, port });
      this.socket = socket;
      socket.setNoDelay(true);
      const timer = connectTimeout > 0
        ? setTimeout(() => {
          const err = new DenisError(`connect timeout after ${connectTimeout} ms (${host}:${port})`, "ETIMEOUT");
          settle(err);
          this.destroy(err);
        }, connectTimeout)
        : null;
      socket.once("connect", () => {
        socket.setKeepAlive(true, 30000);
        settle();
      });
      socket.on("error", (err) => {
        const wrapped = err instanceof DenisError ? err : new DenisError(`${err.message} (${host}:${port})`, "ECONN");
        if (!this._closeError) this._closeError = wrapped;
        settle(wrapped);
      });
      socket.on("data", (chunk) => this._onData(chunk));
      socket.on("close", () => {
        settle(this._closeError || new DenisError(`connection closed (${host}:${port})`, "ECONN"));
        this._onClose();
      });
    });
  }

  /** MODE json, LIN, AUTH — pipelined in one write; AUTH CREATE when asked to create a project. */
  async handshake() {
    const { group, password, createProject } = this.options;
    const lines = ["MODE json"];
    const login = group !== undefined && group !== null;
    if (login) {
      assertWord(group, "group");
      const secret = password === undefined || password === null ? "" : String(password);
      if (/[\r\n]/.test(secret)) throw new DenisError("password must not contain line breaks", "EINVAL");
      lines.push(`LIN ${group} ${secret}`);
    }
    if (this.token) {
      assertWord(this.token, "token");
      lines.push(`AUTH ${this.token}`);
    }
    const settled = await Promise.allSettled(lines.map((line) => this.raw(line)));
    // the first failure in send order explains the rest (a refused login makes AUTH fail too)
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === "rejected") {
        // the server may have refused the connection (LIMIT) before answering
        throw this._closeError && this._closeError.reply ? this._closeError : result.reason;
      }
      const reply = result.value;
      if (reply.ok) continue;
      if (i === 0) {
        throw new DenisError(`server refused MODE json: ${reply.error || "old server?"}`, reply.code || "EPROTO", reply);
      }
      throw replyError(reply, lines[i].startsWith("LIN") ? "login failed" : "AUTH failed");
    }
    if (!this.token && createProject) {
      const created = await this.raw("AUTH CREATE");
      if (!created.ok || !created.token) throw replyError(created, "AUTH CREATE failed");
      const auth = await this.raw(`AUTH ${created.token}`);
      if (!auth.ok) throw replyError(auth, "AUTH failed");
      this.token = created.token;
    }
    this.ready = true;
  }

  /** Number of commands waiting for their reply. */
  get inFlight() {
    return this.pending.length;
  }

  /**
   * Send one line and resolve with the parsed reply object (never rejects on ok:false).
   * @param {string} line
   * @param {{timeout?: number}} [opts]
   */
  raw(line, opts = {}) {
    try {
      assertLine(line);
    } catch (err) {
      return Promise.reject(err);
    }
    const timeout = opts.timeout ?? this.options.commandTimeout;
    return new Promise((resolve, reject) => {
      this._enqueue({ line, parse: null, resolve, reject, deadline: deadlineOf(timeout), timeout, done: false });
    });
  }

  /** Send EXIT after everything in flight, resolve once the connection is closed. */
  quit() {
    if (this.closed) return Promise.resolve();
    this.retiring = true;
    // EXIT is answered after everything in flight: give it at least as long as they have
    let timeout = this.options.commandTimeout;
    for (const req of this.pending) {
      if (!req.deadline) timeout = 0;
      if (timeout > 0) timeout = Math.max(timeout, req.deadline - Date.now() + 1000);
    }
    return new Promise((resolve) => {
      this.once("close", () => resolve());
      this.raw("EXIT", { timeout })
        .catch(() => {})
        .then(() => this.destroy());
    });
  }

  /** Close the socket now; commands in flight are rejected with ECLOSED. */
  destroy(err) {
    if (err && !this._closeError) this._closeError = err;
    if (this.socket) this.socket.destroy();
    this._onClose();
  }

  // ------------------------------------------------------------------- internals

  _enqueue(req) {
    if (this.closed || !this.socket) {
      req.reject(new DenisError("connection is closed", "ECLOSED"));
      return;
    }
    this.pending.push(req);
    this._out += req.line + "\n";
    // the server closes the connection after EXIT/QUIT: stop routing commands here
    const first = req.line.charCodeAt(0) | 0x20;
    if ((first === 101 || first === 113) && /^(exit|quit)(\s|$)/i.test(req.line)) this.retiring = true;
    if (!this._flushScheduled) {
      this._flushScheduled = true;
      setImmediate(this._flush);
    }
    if (req.deadline) this._timer.arm(req.deadline);
  }

  /** A single command or a pipeline batch ({batch, deadline}); a batch goes out in one write. */
  _enqueueUnit(unit) {
    if (unit.batch) {
      for (const req of unit.batch) {
        req.deadline = unit.deadline;
        req.timeout = unit.timeout;
        this._enqueue(req);
      }
    } else {
      this._enqueue(unit);
    }
  }

  _flush() {
    this._flushScheduled = false;
    if (this.closed || this._out.length === 0) return;
    const out = this._out;
    this._out = "";
    this.socket.write(out);
  }

  /** Split on \n at the byte level so multi-byte UTF-8 characters split across chunks stay intact. */
  _onData(chunk) {
    let start = 0;
    let index;
    while ((index = chunk.indexOf(10, start)) !== -1) {
      let line;
      if (this._partial.length > 0) {
        this._partial.push(chunk.subarray(start, index));
        line = Buffer.concat(this._partial);
        this._partial = [];
      } else {
        line = chunk.subarray(start, index);
      }
      start = index + 1;
      let end = line.length;
      if (end > 0 && line[end - 1] === 13) end--;
      if (end > 0) this._onLine(line.toString("utf8", 0, end));
      if (this.closed) return;
    }
    if (start < chunk.length) this._partial.push(start === 0 ? chunk : chunk.subarray(start));
  }

  _onLine(text) {
    const req = this.pending.shift();
    if (!req) {
      this._unsolicited(text);
      return;
    }
    if (this.pending.length === 0) this._timer.clear();
    const reply = parseReply(text);
    req.done = true;
    if (req.parse) {
      let value;
      try {
        value = req.parse(reply);
      } catch (err) {
        req.reject(err);
        if (this._onReply) this._onReply(this);
        return;
      }
      req.resolve(value);
    } else {
      req.resolve(reply);
    }
    if (this._onReply) this._onReply(this);
  }

  /** A line nobody waits for: the server's refusal (LIMIT) before it closes, or noise. */
  _unsolicited(text) {
    const reply = parseReply(text);
    if (!reply.ok && !this._closeError) {
      this._closeError = replyError(reply, "server error");
    }
  }

  _checkDeadlines() {
    const { expired, min } = scanDeadlines(this.pending, Date.now());
    if (expired) {
      this._timedOut = expired;
      const command = expired.line.split(" ", 1)[0];
      this.destroy(new DenisError(`no reply within ${expired.timeout} ms for ${command}; connection dropped`, "ETIMEOUT"));
    } else if (min) {
      this._timer.arm(min);
    }
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this._timer.clear();
    this._partial = [];
    this._out = "";
    const reason = this._closeError;
    const cause = reason ? `: ${reason.message}` : "";
    for (const req of this.pending.clear()) {
      if (req === this._timedOut) {
        req.reject(new DenisError(reason.message, "ETIMEOUT"));
      } else {
        req.reject(new DenisError(`connection closed before the reply arrived${cause}`, "ECLOSED", reason && reason.reply));
      }
    }
    this.emit("close", reason);
  }
}

// ======================================================================= commands

/**
 * Every key-value / SQL / admin command as a builder returning
 * `{ line, parse }` (or `{ value }` when no round trip is needed). Builders
 * validate their arguments synchronously (EINVAL) and are shared by
 * DenisClient (one promise per command) and DenisPipeline (one batch).
 * They are called with `this` = the client.
 */
const COMMANDS = {
  /** PING -> true */
  ping() {
    return { line: "PING", parse: (r) => (expectOk(r), true) };
  },

  /** HELLO -> {server, version, protocol, features, loggedIn} */
  hello() {
    return { line: "HELLO", parse: strip };
  },

  /** GET -> string, or null when the key does not exist */
  get(key, opts = {}) {
    assertKey(key);
    const flag = opts.source === "protobuf" ? " -&from-protobuff" : opts.source === "cache" ? " -&from-cache" : "";
    return { line: `GET ${key}${flag}`, parse: getValue };
  },

  /** GET + JSON.parse -> any, or null when the key does not exist */
  getJSON(key, opts = {}) {
    const cmd = COMMANDS.get(key, opts);
    return {
      line: cmd.line,
      parse: (r) => {
        const value = getValue(r);
        return value === null ? null : JSON.parse(value);
      },
    };
  },

  /** SET [-&save] [-&ttl=s] -> true; non-strings are JSON.stringify-ed */
  set(key, value, opts = {}) {
    assertKey(key);
    const text = encodeValue(value);
    let flags = "";
    if (opts.persist) flags += " -&save";
    if (opts.ttl !== undefined && opts.ttl !== null) {
      assertPositive(opts.ttl, "ttl");
      flags += ` -&ttl=${opts.ttl}`;
    }
    if (!flags && needsGuardFlag(text)) flags = " -&cache";
    return { line: `SET ${key} ${text}${flags}`, parse: okTrue };
  },

  /** UPDATE (cache only) -> true */
  update(key, value) {
    assertKey(key);
    const text = encodeValue(value);
    // UPDATE cannot carry a flag; SET without -&save is the same cache-only write
    const line = needsGuardFlag(text) ? `SET ${key} ${text} -&cache` : `UPDATE ${key} ${text}`;
    return { line, parse: okTrue };
  },

  /** DEL [-&cache|-&protobuff] -> whether the key existed */
  del(key, opts = {}) {
    assertKey(key);
    const flag = opts.cache && !opts.protobuf ? " -&cache" : opts.protobuf && !opts.cache ? " -&protobuff" : "";
    return { line: `DEL ${key}${flag}`, parse: (r) => expectOk(r).deleted !== false };
  },

  /** EXISTS -> boolean */
  exists(key) {
    assertKey(key);
    return { line: `EXISTS ${key}`, parse: (r) => expectOk(r).exists === true };
  },

  /** KEYS [pattern] [-&cache|-&protobuff] [-&limit=n] -> string[] */
  keys(pattern = "*", opts = {}) {
    if (typeof pattern !== "string" || pattern.length === 0 || /\s/.test(pattern) || pattern.startsWith("-&")) {
      throw new DenisError("pattern must be a non-empty glob without whitespace", "EINVAL");
    }
    let line = `KEYS ${pattern}`;
    const layer = opts.layer || "any";
    if (layer === "cache") line += " -&cache";
    else if (layer === "persistent") line += " -&protobuff";
    else if (layer !== "any") throw new DenisError(`layer must be any, cache or persistent: ${layer}`, "EINVAL");
    if (opts.limit !== undefined && opts.limit !== null) {
      if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new DenisError("limit must be a positive integer", "EINVAL");
      line += ` -&limit=${opts.limit}`;
    }
    return { line, parse: (r) => expectOk(r).keys || [] };
  },

  /** MGET -> { key: value | null } */
  mget(keys) {
    if (!Array.isArray(keys)) throw new DenisError("mget expects an array of keys", "EINVAL");
    if (keys.length === 0) return { value: {} };
    keys.forEach(assertKey);
    return { line: `MGET ${keys.join(" ")}`, parse: (r) => expectOk(r).data || {} };
  },

  /** INCR [delta] [-&save] -> the new value */
  incr(key, delta = 1, opts = {}) {
    return counter("INCR", key, delta, opts);
  },

  /** DECR [delta] [-&save] -> the new value */
  decr(key, delta = 1, opts = {}) {
    return counter("DECR", key, delta, opts);
  },

  /** EXPIRE -> whether a cache value got the TTL */
  expire(key, seconds) {
    assertKey(key);
    assertPositive(seconds, "seconds");
    return { line: `EXPIRE ${key} ${seconds}`, parse: (r) => expectOk(r).updated === true };
  },

  /** TTL -> seconds; -1 no TTL, -2 no cache value */
  ttl(key) {
    assertKey(key);
    return { line: `TTL ${key}`, parse: (r) => expectOk(r).ttl };
  },

  /** PERSIST -> whether a TTL was removed */
  persist(key) {
    assertKey(key);
    return { line: `PERSIST ${key}`, parse: (r) => expectOk(r).updated === true };
  },

  /** DBSIZE -> {keys, cache, persistent, tables} */
  dbsize() {
    return {
      line: "DBSIZE",
      parse: (r) => {
        expectOk(r);
        return { keys: r.keys, cache: r.cache, persistent: r.persistent, tables: r.tables };
      },
    };
  },

  /** HEAVEN: drop every cache value of the project -> true */
  clear() {
    return { line: "HEAVEN", parse: okTrue };
  },

  /** SQL <statement> -> the 0.0.x text result (reply.data) */
  sql(statement) {
    if (typeof statement !== "string" || statement.trim().length === 0 || /[\r\n]/.test(statement)) {
      throw new DenisError("statement must be a non-empty single line (use query() for multi-line SQL)", "EINVAL");
    }
    return { line: `SQL ${statement}`, parse: (r) => expectOk(r).data };
  },

  /** QUERY {"sql","params"} -> {columns, rows, count, affected, lastRowId, message} */
  query(sql, params = []) {
    return { line: queryLine(sql, params), parse: sqlResult };
  },

  /** QUERY -> rows as objects keyed by column name */
  queryObjects(sql, params = []) {
    return { line: queryLine(sql, params), parse: (r) => rowsToObjects(sqlResult(r)) };
  },

  /** DUMP -> the whole project (without "ok"), the input of import() */
  dump(opts = {}) {
    return { line: "DUMP", parse: strip, timeout: opts.timeout };
  },

  /** INFO -> reply.info */
  info() {
    return { line: "INFO", parse: (r) => expectOk(r).info };
  },

  /** WHOAMI -> {group, admin, project} */
  whoami() {
    return {
      line: "WHOAMI",
      parse: (r) => {
        expectOk(r);
        return { group: r.group, admin: r.admin, project: r.project ?? null };
      },
    };
  },

  /** PROJECTS -> [{token, owner, keys, tables, current}] */
  projects() {
    return { line: "PROJECTS", parse: (r) => expectOk(r).projects || [] };
  },

  /** AUTH CREATE -> the new token (the client stays on its current project) */
  createProject() {
    return { line: "AUTH CREATE", parse: (r) => expectOk(r).token };
  },

  /** AUTH DELETE <token> -> true; deleting the current project leaves the client without one */
  deleteProject(token) {
    assertWord(token, "token");
    const client = this;
    return {
      line: `AUTH DELETE ${token}`,
      parse: (r) => {
        expectOk(r);
        if (client && token === client._token) client._projectDeleted();
        return true;
      },
    };
  },

  /** SAVE (admin) -> {message, bytes, records, millis} */
  save(opts = {}) {
    return { line: "SAVE", parse: strip, timeout: opts.timeout };
  },

  /** BACKUP (admin) -> {message, name, path, bytes, createdAt} */
  backup(opts = {}) {
    return { line: "BACKUP", parse: strip, timeout: opts.timeout };
  },

  /** BACKUPS (admin) -> {backups: [{name, path, bytes, createdAt}], directory} */
  backups() {
    return { line: "BACKUPS", parse: strip };
  },

  /** Any protocol line -> the parsed reply object (never rejects on ok:false) */
  command(line, opts = {}) {
    assertLine(line);
    return { line, parse: null, timeout: opts.timeout };
  },
};

function okTrue(reply) {
  expectOk(reply);
  return true;
}

function getValue(reply) {
  if (reply.ok) return reply.data ?? null;
  if (reply.code === "NOTFOUND" || reply.error === "not found") return null;
  throw replyError(reply);
}

function counter(command, key, delta, opts) {
  assertKey(key);
  if (!Number.isSafeInteger(delta)) throw new DenisError("delta must be an integer", "EINVAL");
  const line = `${command} ${key}${delta === 1 ? "" : ` ${delta}`}${opts && opts.persist ? " -&save" : ""}`;
  return { line, parse: (r) => expectOk(r).value };
}

function queryLine(sql, params) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new DenisError("sql must be a non-empty string", "EINVAL");
  }
  if (!Array.isArray(params)) throw new DenisError("params must be an array", "EINVAL");
  // JSON.stringify escapes line breaks, so multi-line SQL is fine here
  return `QUERY ${JSON.stringify({ sql, params }, jsonReplacer)}`;
}

/**
 * Split a DUMP object into IMPORT lines of at most `limit` bytes where
 * possible: persistent keys in chunks, cache keys (with their TTLs) in chunks,
 * tables split into row chunks (the first line creates the table, later lines
 * append). A single entry or row larger than the limit still gets its own line.
 */
function importLines(data, replace, limit) {
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new DenisError(`import data is not valid JSON: ${err.message}`, "EINVAL");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DenisError("import expects a DUMP object", "EINVAL");
  }
  const { ok, cache, persistent, ttl, tables, replace: dumpReplace, ...meta } = data; // eslint-disable-line no-unused-vars
  const header = { ...meta, replace: replace ?? dumpReplace ?? false };
  const whole = JSON.stringify({ ...header, persistent, cache, ttl, tables });
  if (Buffer.byteLength(whole) + 8 <= limit) return [whole];

  const lines = [];
  const base = Buffer.byteLength(JSON.stringify(header)) + 32;
  const entryBytes = (k, v) => Buffer.byteLength(JSON.stringify(k)) + Buffer.byteLength(JSON.stringify(v)) + 2;

  let chunk = null;
  let chunkTtl = null;
  let size = base;
  const flush = (field) => {
    if (!chunk) return;
    const line = { ...header, [field]: chunk };
    if (chunkTtl) line.ttl = chunkTtl;
    lines.push(JSON.stringify(line));
    chunk = null;
    chunkTtl = null;
    size = base;
  };

  for (const [key, value] of Object.entries(persistent || {})) {
    const bytes = entryBytes(key, value);
    if (chunk && size + bytes > limit) flush("persistent");
    if (!chunk) chunk = Object.create(null);
    chunk[key] = value;
    size += bytes;
  }
  flush("persistent");

  for (const [key, value] of Object.entries(cache || {})) {
    const hasTtl = ttl && Object.prototype.hasOwnProperty.call(ttl, key);
    const bytes = entryBytes(key, value) + (hasTtl ? entryBytes(key, ttl[key]) : 0);
    if (chunk && size + bytes > limit) flush("cache");
    if (!chunk) chunk = Object.create(null);
    chunk[key] = value;
    if (hasTtl) {
      if (!chunkTtl) chunkTtl = Object.create(null);
      chunkTtl[key] = ttl[key];
    }
    size += bytes;
  }
  flush("cache");

  // a table that does not fit one line: the first line creates it, the rest append rows (server "append")
  for (const [name, def] of Object.entries(tables || {})) {
    const { rows = [], ...shape } = def || {};
    const shapeBytes = base + Buffer.byteLength(JSON.stringify(shape)) + Buffer.byteLength(name) + 16;
    let part = [];
    let partBytes = shapeBytes;
    let first = true;
    const flushRows = () => {
      const line = first
        ? { ...header, tables: { [name]: { ...shape, rows: part } } }
        : { ...header, replace: false, append: true, tables: { [name]: { columns: shape.columns, rows: part } } };
      lines.push(JSON.stringify(line));
      first = false;
      part = [];
      partBytes = shapeBytes;
    };
    for (const row of rows) {
      const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (part.length > 0 && partBytes + bytes > limit) flushRows();
      part.push(row);
      partBytes += bytes;
    }
    if (part.length > 0 || first) flushRows();
  }
  return lines;
}

// ======================================================================= pipeline

/**
 * Commands collected and sent together, in one write, on one connection;
 * the server answers them in order. `exec()` resolves to one entry per
 * command: its value, or a DenisError instance when that command failed.
 *
 *   const [ok, value, n] = await client.pipeline().set("a", "1").get("a").incr("n").exec();
 */
class DenisPipeline {
  constructor(client) {
    this._client = client;
    this._commands = [];
  }

  /** Number of queued commands. */
  get length() {
    return this._commands.length;
  }

  _add(build, args) {
    let cmd;
    try {
      cmd = build.apply(this._client, args);
    } catch (err) {
      cmd = { error: err };
    }
    this._commands.push(cmd);
    return this;
  }

  /** Send everything queued so far; the pipeline can be reused afterwards. */
  exec(opts = {}) {
    const commands = this._commands;
    this._commands = [];
    const results = new Array(commands.length);
    return new Promise((resolve) => {
      const timeout = opts.timeout ?? this._client.options.commandTimeout;
      const batch = [];
      let left = 0;
      const settle = () => {
        if (--left === 0) resolve(results);
      };
      commands.forEach((cmd, i) => {
        if (cmd.error) {
          results[i] = cmd.error;
        } else if (Object.prototype.hasOwnProperty.call(cmd, "value")) {
          results[i] = cmd.value;
        } else {
          left++;
          batch.push({
            line: cmd.line,
            parse: cmd.parse,
            resolve: (value) => {
              results[i] = value;
              settle();
            },
            reject: (err) => {
              results[i] = err;
              settle();
            },
            deadline: 0,
            timeout,
            done: false,
          });
        }
      });
      if (left === 0) {
        resolve(results);
        return;
      }
      this._client._dispatch({ batch, deadline: deadlineOf(timeout), timeout, done: false });
    });
  }
}

// ======================================================================= client

function normalizeReconnect(value) {
  if (value === false || value === null) return null;
  if (value === undefined || value === true) return { ...RECONNECT_DEFAULTS };
  return { ...RECONNECT_DEFAULTS, ...value };
}

/** Server-side refusals that retrying will not fix. */
function isFatal(err) {
  if (!(err instanceof DenisError)) return false;
  if (err.code === "EINVAL" || err.code === "EPROTO") return true;
  return Boolean(err.reply) && !["LIMIT", "BUSY", "LOCKED", "INTERNAL"].includes(err.code);
}

/**
 * A pool of pipelined, authenticated connections with the key-value / SQL API.
 *
 * Events: "connect" (a pooled connection is ready), "reconnect" ({attempt, delay, error}
 * before each reconnect attempt), "error" (gave up reconnecting; only emitted when a
 * listener is attached), "close" (after close()).
 */
class DenisClient extends EventEmitter {
  constructor(options = {}) {
    super();
    const o = { ...DEFAULTS, ...options, reconnect: normalizeReconnect(options.reconnect) };
    if (!Number.isInteger(o.poolSize) || o.poolSize < 1) throw new DenisError("poolSize must be an integer >= 1", "EINVAL");
    if (!Number.isInteger(o.maxPending) || o.maxPending < 1) throw new DenisError("maxPending must be an integer >= 1", "EINVAL");
    this.options = o;
    this._token = o.token || undefined;
    this._createOnHandshake = Boolean(o.createProject);
    this._slots = Array.from({ length: o.poolSize }, (_, id) => ({ id, conn: null, state: "idle", sleep: null }));
    this._waiting = new Fifo(); // units waiting for a connection with room
    this._waitTimer = new DeadlineTimer(() => this._checkWaiting());
    this._starting = null;
    this._closing = false;
    this._closePromise = null;
    this._onReply = () => {
      if (this._waiting.length > 0) this._drain();
    };
  }

  /** The current project token (given, created, or selected with use()). */
  get token() {
    return this._token;
  }

  /** Open the pool eagerly (optional: commands connect on demand). Resolves to the client. */
  async connect() {
    if (this._closing) throw new DenisError("client is closed", "ECLOSED");
    await this._start();
    return this;
  }

  /** A new pipeline bound to this client. */
  pipeline() {
    return new DenisPipeline(this);
  }

  /** Switch every pooled connection (and future ones) to another project. */
  use(token) {
    try {
      assertWord(token, "token");
    } catch (err) {
      return Promise.reject(err);
    }
    if (this._closing) return Promise.reject(new DenisError("client is closed", "ECLOSED"));
    // with ready connections, AUTH is queued synchronously: commands issued after use() run on the new project
    if (this._readyConnections().length > 0) return this._switchProject(token);
    return this._start().then(() => this._switchProject(token));
  }

  /**
   * IMPORT a DUMP object (or its JSON text). Large dumps are split into
   * several IMPORT lines, sent one after another.
   * @returns {Promise<{persistent: number, cache: number, tables: number, rows: number}>}
   */
  async import(data, opts = {}) {
    const lines = importLines(data, opts.replace, opts.chunkBytes || this.options.importChunkBytes);
    const total = { persistent: 0, cache: 0, tables: 0, rows: 0 };
    for (const json of lines) {
      let imported;
      try {
        imported = await this._request(`IMPORT ${json}`, (r) => expectOk(r).imported || {}, opts.timeout);
      } catch (err) {
        err.imported = total; // what made it in before the failure
        throw err;
      }
      for (const field of Object.keys(total)) {
        // an "append" line continues a table that an earlier line created: count the table once
        if (field === "tables" && json.includes('"append":true')) continue;
        total[field] += Number(imported[field] || 0);
      }
    }
    return total;
  }

  /** Close every connection gracefully (EXIT after the commands in flight). */
  close() {
    if (this._closePromise) return this._closePromise;
    this._closing = true;
    const closed = () => new DenisError("client is closed", "ECLOSED");
    for (const unit of this._waiting.clear()) {
      if (!unit.done) failUnit(unit, closed());
    }
    this._waitTimer.clear();
    const quitting = [];
    for (const slot of this._slots) {
      if (slot.sleep) slot.sleep.cancel();
      const conn = slot.conn;
      const state = slot.state;
      slot.conn = null;
      slot.state = "idle";
      if (!conn) continue;
      if (state === "ready") quitting.push(conn.quit());
      else conn.destroy(closed());
    }
    this._closePromise = Promise.all(quitting).then(() => {
      this.emit("close");
    });
    return this._closePromise;
  }

  // ------------------------------------------------------------------- dispatch

  _run(build, args) {
    let cmd;
    try {
      cmd = build.apply(this, args);
    } catch (err) {
      return Promise.reject(err);
    }
    if (Object.prototype.hasOwnProperty.call(cmd, "value")) return Promise.resolve(cmd.value);
    return this._request(cmd.line, cmd.parse, cmd.timeout);
  }

  _request(line, parse, timeout) {
    const ms = timeout ?? this.options.commandTimeout;
    return new Promise((resolve, reject) => {
      this._dispatch({ line, parse, resolve, reject, deadline: deadlineOf(ms), timeout: ms, done: false });
    });
  }

  /** Write to the least loaded ready connection, or wait in the client queue. */
  _dispatch(unit) {
    if (this._closing) {
      failUnit(unit, new DenisError("client is closed", "ECLOSED"));
      return;
    }
    if (this._waiting.length === 0) {
      const conn = this._pick();
      if (conn) {
        conn._enqueueUnit(unit);
        return;
      }
    }
    this._waiting.push(unit);
    this._waitTimer.arm(unit.deadline);
    this._ensureConnecting();
  }

  _pick() {
    let best = null;
    let bestLoad = this.options.maxPending;
    for (const slot of this._slots) {
      if (slot.state !== "ready") continue;
      const conn = slot.conn;
      if (conn.retiring) continue;
      const load = conn.pending.length;
      if (load < bestLoad) {
        best = conn;
        bestLoad = load;
        if (load === 0) break;
      }
    }
    return best;
  }

  _drain() {
    while (this._waiting.length > 0) {
      const unit = this._waiting.peek();
      if (unit.done) {
        this._waiting.shift();
        continue;
      }
      const conn = this._pick();
      if (!conn) break;
      this._waiting.shift();
      conn._enqueueUnit(unit);
    }
    if (this._waiting.length === 0) this._waitTimer.clear();
  }

  _checkWaiting() {
    const now = Date.now();
    for (const unit of this._waiting) {
      if (!unit.done && unit.deadline && unit.deadline <= now) {
        failUnit(unit, new DenisError(`no connection available within ${unit.timeout} ms`, "ETIMEOUT"));
      }
    }
    const { min } = scanDeadlines(this._waiting, now);
    if (min) this._waitTimer.arm(min);
  }

  _rejectWaiting(err) {
    for (const unit of this._waiting.clear()) {
      if (!unit.done) failUnit(unit, err);
    }
    this._waitTimer.clear();
  }

  _readyConnections() {
    const ready = [];
    for (const slot of this._slots) {
      if (slot.state === "ready" && !slot.conn.retiring) ready.push(slot.conn);
    }
    return ready;
  }

  /** Is any connection ready, being opened, or waiting to reconnect? */
  _alive() {
    return this._slots.some((s) => s.state === "ready" || s.state === "connecting" || s.state === "reconnecting");
  }

  _ensureConnecting() {
    if (!this._alive() && !this._starting) this._start().catch(() => {});
  }

  _emitError(err) {
    if (this.listenerCount("error") > 0) this.emit("error", err);
  }

  // ------------------------------------------------------------------- connections

  /**
   * Open every idle slot: the first alone (it may create the project), the
   * rest in parallel. Rejects when the first cannot be opened; the rest fall
   * back to the reconnect logic.
   */
  _start() {
    if (this._starting) return this._starting;
    const starting = (async () => {
      const idle = this._slots.filter((s) => s.state === "idle" || s.state === "dead");
      if (idle.length === 0) return;
      const [first, ...rest] = idle;
      if (!this._readyConnections().length) {
        try {
          await this._open(first);
        } catch (err) {
          if (!this._alive()) this._rejectWaiting(err);
          throw err;
        }
      } else {
        rest.unshift(first);
      }
      await Promise.all(rest.map((slot) => this._open(slot).catch((err) => {
        if (!this._closing) this._reconnect(slot, err);
      })));
    })();
    this._starting = starting;
    const done = () => {
      if (this._starting === starting) this._starting = null;
    };
    starting.then(done, done);
    return starting;
  }

  async _open(slot) {
    if (this._closing) throw new DenisError("client is closed", "ECLOSED");
    const conn = new DenisConnection({
      ...this.options,
      token: this._token,
      createProject: this._createOnHandshake && !this._token,
      onReply: this._onReply,
    });
    slot.conn = conn;
    slot.state = "connecting";
    try {
      await conn.connect();
      await conn.handshake();
      if (!this._token && conn.token) this._token = conn.token;
      // use() may have switched projects while this connection was handshaking
      while (this._token && conn.token !== this._token && !conn.closed) {
        const token = this._token;
        expectOk(await conn.raw(`AUTH ${token}`));
        conn.token = token;
      }
      if (this._closing) throw new DenisError("client is closed", "ECLOSED");
      if (conn.closed) throw conn._closeError || new DenisError("connection closed during the handshake", "ECLOSED");
    } catch (err) {
      conn.destroy();
      if (slot.conn === conn) {
        slot.conn = null;
        slot.state = "idle";
      }
      throw err;
    }
    this._createOnHandshake = false;
    slot.state = "ready";
    conn.on("close", (err) => this._onConnectionClose(slot, conn, err));
    this.emit("connect", { slot: slot.id });
    this._drain();
    return conn;
  }

  _onConnectionClose(slot, conn, err) {
    if (slot.conn !== conn) return;
    slot.conn = null;
    slot.state = "idle";
    if (this._closing) return;
    if (conn.retiring && !err) {
      // a planned recycle (EXIT): open a fresh connection right away
      this._open(slot).catch((e) => this._reconnect(slot, e));
      return;
    }
    this._reconnect(slot, err || new DenisError("connection closed by the server", "ECONN"));
  }

  /** Re-open a dropped slot with exponential backoff and jitter. */
  _reconnect(slot, cause) {
    const policy = this.options.reconnect;
    if (!policy) {
      // no background reconnect; commands still open a fresh connection on demand
      slot.state = "idle";
      if (this._waiting.length > 0) this._ensureConnecting();
      return;
    }
    if (isFatal(cause)) {
      slot.state = "dead";
      this._emitError(cause);
      if (!this._alive()) this._rejectWaiting(cause);
      return;
    }
    slot.state = "reconnecting";
    (async () => {
      let lastError = cause;
      for (let attempt = 1; attempt <= policy.retries; attempt++) {
        const base = Math.min(policy.maxDelay, policy.minDelay * 2 ** (attempt - 1));
        const delay = Math.round(base / 2 + (Math.random() * base) / 2);
        this.emit("reconnect", { attempt, delay, error: lastError });
        await this._sleep(slot, delay);
        if (this._closing) return;
        try {
          await this._open(slot);
          return;
        } catch (err) {
          if (this._closing) return;
          slot.state = "reconnecting";
          lastError = err;
          if (isFatal(err)) break;
        }
      }
      slot.state = "dead";
      const { host, port } = this.options;
      const err = new DenisError(
        `gave up reconnecting to ${host}:${port} after ${policy.retries} attempt(s): ${lastError.message}`,
        lastError.code || "ECONN",
        lastError.reply,
      );
      this._emitError(err);
      if (!this._alive()) this._rejectWaiting(err);
    })();
  }

  _sleep(slot, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        slot.sleep = null;
        resolve();
      }
      slot.sleep = { cancel: done };
    });
  }

  _authOn(conn, token) {
    const timeout = this.options.commandTimeout;
    return new Promise((resolve, reject) => {
      conn._enqueue({
        line: `AUTH ${token}`,
        parse: (r) => {
          expectOk(r);
          conn.token = token;
          return true;
        },
        resolve,
        reject,
        deadline: deadlineOf(timeout),
        timeout,
        done: false,
      });
    });
  }

  async _switchProject(token) {
    const previous = this._token;
    this._token = token;
    const conns = this._readyConnections();
    const results = await Promise.allSettled(conns.map((conn) => this._authOn(conn, token)));
    const failed = results.find((r) => r.status === "rejected");
    if (!failed) return true;
    this._token = previous;
    if (previous) {
      await Promise.allSettled(
        conns.filter((_, i) => results[i].status === "fulfilled").map((conn) => this._authOn(conn, previous)),
      );
    }
    throw failed.reason;
  }

  /** The current project was deleted: recycle the connections so none keeps using it. */
  _projectDeleted() {
    this._token = undefined;
    for (const conn of this._readyConnections()) conn.quit();
  }
}

for (const [name, build] of Object.entries(COMMANDS)) {
  DenisClient.prototype[name] = function (...args) {
    return this._run(build, args);
  };
  DenisPipeline.prototype[name] = function (...args) {
    return this._add(build, args);
  };
}

module.exports = { DenisClient, DenisConnection, DenisError, DenisPipeline };

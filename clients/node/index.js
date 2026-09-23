"use strict";

/**
 * Node.js client for Denis Database (wire protocol version 2, see docs/PROTOCOL.md).
 *
 * Two transports, one API (DenisCommands):
 *
 *  - DenisClient talks TCP to a server you run. Every connection first
 *    switches to `MODE json` (one JSON object per reply), logs in (`LIN`) and
 *    selects a project (`AUTH`); the three lines are sent in one write.
 *    Replies arrive in order, so a connection does not wait for a reply before
 *    sending the next command: each connection keeps a FIFO of pending replies
 *    and commands are written as soon as they are issued (pipelining). The
 *    client keeps a small pool of such connections, opened on demand, and
 *    sends each command to the least loaded one. Commands issued in the same
 *    tick are coalesced into one socket write. Dropped connections are
 *    re-opened with backoff and re-run the handshake.
 *
 *  - DenisCloud talks HTTPS to the Denis Cloud gateway with an API key.
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
   * @param {string} code  ECONN | ETIMEOUT | EAUTH | EPROTO | ESERVER | ECLOSED | EINVAL | ELIMIT
   * @param {object} [reply] the server's JSON reply, when there was one; its `code`
   *                         (SQL, NOTFOUND, QUOTA, AUTH, ...) is copied to `serverCode`
   */
  constructor(message, code, reply) {
    super(message);
    this.name = "DenisError";
    this.code = code;
    if (reply) {
      this.reply = reply;
      if (typeof reply.code === "string") this.serverCode = reply.code;
    }
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
  // false = one command in flight per connection (the 0.5 option; same as maxPending: 1)
  pipeline: true,
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

function assertCount(n, what) {
  if (n !== undefined && n !== null && (!Number.isSafeInteger(n) || n < 0)) {
    throw new DenisError(`${what} must be a non-negative integer`, "EINVAL");
  }
}

/** An ok:false reply as a DenisError: ESERVER (EAUTH for LIN/AUTH), the server's code in `serverCode`. */
function replyError(reply, fallback, code = "ESERVER") {
  return new DenisError(reply.error || fallback || "command failed", code, reply);
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

function rowObject(columns, row) {
  const object = {};
  for (let i = 0; i < columns.length; i++) object[columns[i]] = row[i];
  return object;
}

/**
 * The structured SQL result (the reply without `ok`):
 *   { type: "rows", columns, rows: [{col: value}], count }
 *   { type: "affected", affected, message, lastRowId }
 *   { type: "tables", tables: [{name, columns, rows}], count }
 * Replies of a 0.1 server (no `type`, rows as arrays) are converted to that shape.
 */
function sqlResult(reply) {
  const result = strip(reply);
  if (!result.type) {
    if (Array.isArray(result.columns) && (result.columns.length > 0 || Array.isArray(result.rows)) && result.affected === undefined) {
      result.type = "rows";
    } else {
      result.type = "affected";
      if (result.affected === undefined) result.affected = 0;
    }
  }
  if (result.type === "rows") {
    const columns = Array.isArray(result.columns) ? result.columns : [];
    const rows = Array.isArray(result.rows) ? result.rows : [];
    result.columns = columns;
    result.rows = rows.map((row) => (Array.isArray(row) ? rowObject(columns, row) : row));
    if (result.count === undefined || result.count === null) result.count = result.rows.length;
  }
  return result;
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

  /**
   * MODE json, LIN, AUTH — pipelined in one write; AUTH CREATE when asked to create a project.
   * A refused MODE rejects with EPROTO, a refused LIN or AUTH with EAUTH (the server's code in `serverCode`).
   */
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
        // a coded reply is a protocol-2 server refusing the connection (LIMIT, ...), not an old server
        if (reply.code) throw replyError(reply, "connection refused");
        throw new DenisError(`server refused MODE json: ${reply.error || "old server?"}`, "EPROTO", reply);
      }
      throw replyError(reply, lines[i].startsWith("LIN") ? "login failed" : "AUTH failed", "EAUTH");
    }
    if (!this.token && createProject) {
      const created = await this.raw("AUTH CREATE");
      if (!created.ok || !created.token) throw replyError(created, "AUTH CREATE failed", "EAUTH");
      const auth = await this.raw(`AUTH ${created.token}`);
      if (!auth.ok) throw replyError(auth, "AUTH failed", "EAUTH");
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
 * Every command as a builder returning `{ line, parse }` (or `{ value }` when
 * no round trip is needed). Builders validate their arguments synchronously
 * (EINVAL) and are shared by every transport (one promise per command) and
 * by DenisPipeline (one batch). They are called with `this` = the client.
 */
const COMMANDS = {
  /** PING -> whether the server answered ok (false, not an error, on ok:false) */
  ping() {
    return { line: "PING", parse: (r) => r.ok === true };
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

  /** SET [-&cache -&save] [-&ttl=s] -> true; non-strings are JSON.stringify-ed */
  set(key, value, opts = {}) {
    assertKey(key);
    const text = encodeValue(value);
    let flags = "";
    if (opts.persist) flags += " -&cache -&save";
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

  /** DEL [-&cache|-&protobuff] -> whether the key existed (true when the server does not say) */
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
    const layer = (opts && opts.layer) || "any";
    if (layer === "cache") line += " -&cache";
    else if (layer === "persistent") line += " -&protobuff";
    else if (layer !== "any") throw new DenisError(`layer must be any, cache or persistent: ${layer}`, "EINVAL");
    if (opts && opts.limit !== undefined && opts.limit !== null) {
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
    return {
      line: `MGET ${keys.join(" ")}`,
      parse: (r) => {
        expectOk(r);
        const values = r.values ?? r.data;
        return values && typeof values === "object" ? values : {};
      },
    };
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

  /** SAVE -> true (flush the persisted store now; use command("SAVE") for the snapshot details) */
  save(opts = {}) {
    return { line: "SAVE", parse: okTrue, timeout: opts && opts.timeout };
  },

  /** INFO -> the statistics object (the reply without `ok`) */
  info() {
    return { line: "INFO", parse: strip };
  },

  /** HELP -> [{name, usage, description, needsLogin, needsProject}] */
  help() {
    return { line: "HELP", parse: (r) => expectOk(r).commands || [] };
  },

  /** QUERY { ... } (GraphQL-shaped reads) -> {data, errors} */
  graph(document) {
    if (typeof document !== "string" || !document.trim()) throw new DenisError("document is required", "EINVAL");
    return {
      line: "QUERY " + document.replace(/[\r\n]+/g, " ").trim(),
      parse: (r) => {
        const { data, errors } = expectOk(r);
        return { data, errors: errors || [] };
      },
    };
  },

  /** Alias of graph(). */
  queryGraph(document) {
    return COMMANDS.graph(document);
  },

  /** SQL <statement> (or QUERY {"sql","params"} with params) -> the structured result */
  sql(statement, params) {
    return { line: sqlLine(statement, params), parse: sqlResult };
  },

  /** sql() for SELECT -> the row objects */
  query(sql, params) {
    return { line: sqlLine(sql, params), parse: rowsOf };
  },

  /** Alias of query() (the 1.0 name). */
  queryObjects(sql, params) {
    return { line: sqlLine(sql, params), parse: rowsOf };
  },

  /** sql() for INSERT/UPDATE/DELETE/DDL -> the affected row count */
  execute(sql, params) {
    return {
      line: sqlLine(sql, params),
      parse: (r) => {
        const result = sqlResult(r);
        if (result.type !== "affected") throw new DenisError(`expected an affected count, got ${result.type}`, "EPROTO", result);
        return result.affected;
      },
    };
  },

  /** SHOW TABLES -> [{name, columns: [{name, type}], rows}] */
  tables() {
    return {
      line: "SQL SHOW TABLES",
      parse: (r) => {
        const result = sqlResult(r);
        if (result.type !== "tables") throw new DenisError(`expected tables, got ${result.type}`, "EPROTO", result);
        return result.tables || [];
      },
    };
  },

  /** DESCRIBE <table> -> {name, columns, rows}, or null when the table does not exist */
  describe(table) {
    if (typeof table !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new DenisError("invalid table name", "EINVAL");
    return {
      line: `SQL DESCRIBE ${table}`,
      parse: (r) => {
        if (!r.ok && /not found/i.test(r.error || "")) return null;
        const result = sqlResult(r);
        if (result.type !== "tables") throw new DenisError(`expected tables, got ${result.type}`, "EPROTO", result);
        return (result.tables && result.tables[0]) || null;
      },
    };
  },

  /** DUMP -> the whole project (without "ok"), the input of import() */
  dump(opts = {}) {
    return { line: "DUMP", parse: strip, timeout: opts && opts.timeout };
  },
};

/** Commands that only make sense on a TCP session (AUTH, admin groups, the session's identity). */
const SESSION_COMMANDS = {
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
        if (client && typeof client._projectDeleted === "function" && token === client._token) client._projectDeleted();
        return true;
      },
    };
  },

  /** BACKUP (admin) -> {message, name, path, bytes, createdAt} */
  backup(opts = {}) {
    return { line: "BACKUP", parse: strip, timeout: opts && opts.timeout };
  },

  /** BACKUPS (admin) -> {backups: [{name, path, bytes, createdAt}], directory} */
  backups() {
    return { line: "BACKUPS", parse: strip };
  },

  /** Any protocol line -> the parsed reply object (never rejects on ok:false) */
  command(line, opts = {}) {
    assertLine(line);
    return { line, parse: null, timeout: opts && opts.timeout };
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

function rowsOf(reply) {
  const result = sqlResult(reply);
  if (result.type !== "rows") throw new DenisError(`expected rows, got ${result.type}`, "EPROTO", result);
  return result.rows;
}

function counter(command, key, delta, opts) {
  assertKey(key);
  if (!Number.isSafeInteger(delta)) throw new DenisError("delta must be an integer", "EINVAL");
  const line = `${command} ${key}${delta === 1 ? "" : ` ${delta}`}${opts && opts.persist ? " -&save" : ""}`;
  return { line, parse: (r) => expectOk(r).value };
}

/** Without params: `SQL <statement>` (one line). With params (an array, even empty): `QUERY {"sql","params"}`. */
function sqlLine(statement, params) {
  if (typeof statement !== "string" || statement.trim().length === 0) {
    throw new DenisError("sql must be a non-empty string", "EINVAL");
  }
  if (params === undefined || params === null) {
    if (/[\r\n]/.test(statement)) {
      throw new DenisError("query must be a single line (pass params, e.g. [], to send multi-line SQL)", "EINVAL");
    }
    return `SQL ${statement}`;
  }
  if (!Array.isArray(params)) throw new DenisError("params must be an array", "EINVAL");
  // JSON.stringify escapes line breaks, so multi-line SQL is fine here
  return `QUERY ${JSON.stringify({ sql: statement, params }, jsonReplacer)}`;
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

// ======================================================================= shared API

/**
 * The key-value / SQL API shared by every transport. A subclass implements
 * `command(line)` -> reply; every other method is built on top of it
 * (DenisClient overrides `_exec` to pipeline over its pool).
 */
class DenisCommands extends EventEmitter {
  /** Send one protocol line and resolve with the parsed reply object. */
  async command(line) { // eslint-disable-line no-unused-vars
    throw new DenisError("command() is not implemented", "EINVAL");
  }

  /** Run one line and pass the reply through `parse`. */
  async _exec(line, parse) {
    const reply = await this.command(line);
    return parse ? parse(reply) : reply;
  }

  _run(build, args) {
    let cmd;
    try {
      cmd = build.apply(this, args);
    } catch (err) {
      return Promise.reject(err);
    }
    if (Object.prototype.hasOwnProperty.call(cmd, "value")) return Promise.resolve(cmd.value);
    return this._exec(cmd.line, cmd.parse, cmd.timeout);
  }

  /** command() that throws a DenisError (ESERVER) on ok:false (kept from 0.5). */
  async _expectOk(line) {
    return this._exec(line, expectOk);
  }

  /** Default chunk size of import(). */
  get _importChunkBytes() {
    return (this.options && this.options.importChunkBytes) || DEFAULTS.importChunkBytes;
  }

  /**
   * IMPORT a DUMP object (or its JSON text). Large dumps are split into
   * several IMPORT lines, sent one after another.
   * @returns {Promise<{persistent: number, cache: number, tables: number, rows: number}>}
   */
  async import(data, opts = {}) {
    const lines = importLines(data, opts.replace, opts.chunkBytes || this._importChunkBytes);
    const total = { persistent: 0, cache: 0, tables: 0, rows: 0 };
    for (const json of lines) {
      let imported;
      try {
        imported = await this._exec(`IMPORT ${json}`, (r) => expectOk(r).imported || {}, opts.timeout);
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

// ======================================================================= TCP client

function normalizeReconnect(value) {
  if (value === false || value === null) return null;
  if (value === undefined || value === true) return { ...RECONNECT_DEFAULTS };
  return { ...RECONNECT_DEFAULTS, ...value };
}

/** Server-side refusals that retrying will not fix. */
function isFatal(err) {
  if (!(err instanceof DenisError)) return false;
  if (err.code === "EINVAL" || err.code === "EPROTO") return true;
  return Boolean(err.reply) && !["LIMIT", "BUSY", "LOCKED", "INTERNAL"].includes(err.serverCode);
}

/** After a failed attempt to grow the pool, wait this long before trying again. */
const GROW_PAUSE_MS = 1000;

/**
 * A pool of pipelined, authenticated connections with the key-value / SQL API.
 * Connections are opened on demand: the first command opens one, and another
 * is opened (up to poolSize) whenever every open connection is busy.
 * connect() opens the whole pool at once.
 *
 * Events: "connect" (a pooled connection is ready), "reconnect" ({attempt, delay, error}
 * before each reconnect attempt), "error" (gave up reconnecting; only emitted when a
 * listener is attached), "close" (after close()).
 */
class DenisClient extends DenisCommands {
  constructor(options = {}) {
    super();
    const o = { ...DEFAULTS, ...options, reconnect: normalizeReconnect(options.reconnect) };
    if (options.pipeline === false && options.maxPending === undefined) o.maxPending = 1;
    if (!Number.isInteger(o.poolSize) || o.poolSize < 1) throw new DenisError("poolSize must be an integer >= 1", "EINVAL");
    if (!Number.isInteger(o.maxPending) || o.maxPending < 1) throw new DenisError("maxPending must be an integer >= 1", "EINVAL");
    this.options = o;
    this._token = o.token || undefined;
    this._createOnHandshake = Boolean(o.createProject);
    this._slots = Array.from({ length: o.poolSize }, (_, id) => ({ id, conn: null, state: "idle", sleep: null }));
    this._waiting = new Fifo(); // units waiting for a connection with room
    this._waitTimer = new DeadlineTimer(() => this._checkWaiting());
    this._starting = null;
    this._growing = null;
    this._growPausedUntil = 0;
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

  /** Open the whole pool now (optional: commands connect on demand). Resolves to the client. */
  async connect() {
    if (this._closing) throw new DenisError("client is closed", "ECLOSED");
    await this._start(true);
    return this;
  }

  /** A new pipeline bound to this client. */
  pipeline() {
    return new DenisPipeline(this);
  }

  /**
   * Several raw protocol lines in one write on one connection; resolves with
   * the reply objects in order (ok:false replies included, like command()).
   */
  async batch(lines, opts = {}) {
    if (!Array.isArray(lines) || lines.length === 0) throw new DenisError("batch takes a non-empty array of commands", "EINVAL");
    const pipeline = this.pipeline();
    for (const line of lines) pipeline.command(line);
    const results = await pipeline.exec(opts);
    const failed = results.find((r) => r instanceof DenisError);
    if (failed) throw failed;
    return results;
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
   * Project administration with the server's main token (ddb-main-token); no
   * login needed. Every method resolves with the server's reply fields.
   *
   *   const admin = denis.admin(process.env.DENIS_MAIN_TOKEN);
   *   const { token } = await admin.create({ maxKeys: 50000, maxBytes: 10 * 1024 * 1024 });
   *   await admin.usage(token);   // { token, usage: {cachedKeys, cachedBytes, persistedKeys, persistedBytes}, quota }
   */
  admin(mainToken) {
    if (typeof mainToken !== "string" || mainToken.length === 0) throw new DenisError("mainToken is required", "EINVAL");
    if (/\s/.test(mainToken)) throw new DenisError("mainToken must not contain whitespace", "EINVAL");
    const run = async (line) => this._request(`ADMIN ${mainToken} ${line}`, strip);
    const quotaArgs = (quota) => {
      const q = quota || {};
      if (q.maxKeys === undefined && q.maxBytes === undefined) return "";
      assertCount(q.maxKeys, "maxKeys");
      assertCount(q.maxBytes, "maxBytes");
      return ` ${q.maxKeys ?? 0} ${q.maxBytes ?? 0}`;
    };
    const withToken = (fn) => async (token, ...rest) => {
      assertWord(token, "token");
      return fn(token, ...rest);
    };
    return {
      list: async () => (await run("LIST")).projects,
      create: async (quota) => run(`CREATE${quotaArgs(quota)}`),
      // adopt a token issued before the engine's registry was lost; idempotent
      import: withToken((token, quota) => run(`IMPORT ${token}${quotaArgs(quota)}`)),
      usage: withToken((token) => run(`USAGE ${token}`)),
      quota: withToken((token, maxKeys, maxBytes) => {
        assertCount(maxKeys, "maxKeys");
        assertCount(maxBytes, "maxBytes");
        return run(`QUOTA ${token} ${maxKeys ?? 0} ${maxBytes ?? 0}`);
      }),
      flush: withToken((token) => run(`FLUSH ${token}`).then(() => true)),
      drop: withToken((token) => run(`DROP ${token}`).then(() => true)),
    };
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

  _exec(line, parse, timeout) {
    return this._request(line, parse, timeout);
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
        const busy = conn.pending.length > 0;
        conn._enqueueUnit(unit);
        if (busy) this._grow();
        return;
      }
    }
    this._waiting.push(unit);
    this._waitTimer.arm(unit.deadline);
    this._ensureConnecting();
    this._grow();
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
    else this._grow();
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
   * Open the first connection when none is ready (it may create the project),
   * and with `all` every other idle slot in parallel. Rejects when the first
   * cannot be opened; the rest fall back to the reconnect logic.
   */
  _start(all = false) {
    if (this._starting) return all ? this._starting.then(() => this._start(true)) : this._starting;
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
      if (!all) return;
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

  /** Every open connection is busy: open one more idle slot in the background. */
  _grow() {
    if (this._closing || this._growing || this._starting || Date.now() < this._growPausedUntil) return;
    if (this._readyConnections().length === 0) return; // the start / reconnect logic owns an empty pool
    const slot = this._slots.find((s) => s.state === "idle");
    if (!slot) return;
    const growing = this._open(slot).then(
      () => true,
      () => {
        this._growPausedUntil = Date.now() + GROW_PAUSE_MS;
        return false;
      },
    );
    this._growing = growing;
    growing.then((opened) => {
      if (this._growing === growing) this._growing = null;
      // commands still queued (maxPending reached everywhere): keep growing
      if (opened && this._waiting.length > 0) this._grow();
    });
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
        const reply = await conn.raw(`AUTH ${token}`);
        if (!reply.ok) throw replyError(reply, "AUTH failed", "EAUTH");
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
          if (!r.ok) throw replyError(r, "AUTH failed", "EAUTH");
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

// ======================================================================= Denis Cloud

/** The Denis Cloud gateway takes commands of at most 64 KB: import() stays below that. */
const CLOUD_IMPORT_CHUNK_BYTES = 48 * 1024;

/**
 * The same API over Denis Cloud's REST gateway (https://denis.hacimertgokhan.com).
 * No TCP, no group login: an API key from the database's Connect tab is all
 * that is needed. Read-scoped keys can only run read commands; the gateway
 * answers writes with a READ_ONLY error.
 *
 *   const { DenisCloud } = require("denis-client");
 *   const denis = new DenisCloud({ apiKey: process.env.DENIS_API_KEY });
 *   await denis.set("greeting", "hello world", { persist: true });
 *   await denis.get("greeting");                              // "hello world"
 *   await denis.query("SELECT * FROM products WHERE price > 10");
 *   await denis.usage();                                      // { usage, limits, ... }
 *
 * Every command is one HTTPS request; batch() sends up to 50 in one request.
 * With { useJwt: true } the key is exchanged for a short-lived access token
 * (and refreshed automatically) so the key itself never travels after the
 * first call.
 */
class DenisCloud extends DenisCommands {
  constructor(options = {}) {
    super();
    this.url = String(options.url || "https://denis.hacimertgokhan.com").replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    if (!this.apiKey && !this.accessToken) throw new DenisError("apiKey or accessToken is required", "EINVAL");
    this.timeout = options.timeout ?? 15000;
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== "function") throw new DenisError("fetch is not available; pass options.fetch", "EINVAL");
    this.useJwt = options.useJwt === true && Boolean(this.apiKey);
    this.refreshToken = undefined;
    this.expiresAt = 0;
    this.exchanging = null;
    this.importChunkBytes = options.importChunkBytes || CLOUD_IMPORT_CHUNK_BYTES;
  }

  get _importChunkBytes() {
    return this.importChunkBytes;
  }

  /** The Bearer credential for the next request; exchanges or refreshes the JWT pair when useJwt is on. */
  async _bearer() {
    if (!this.useJwt) return this.accessToken || this.apiKey;
    if (this.accessToken && Date.now() < this.expiresAt - 30_000) return this.accessToken;
    if (!this.exchanging) {
      const body = this.refreshToken ? { refreshToken: this.refreshToken } : { apiKey: this.apiKey };
      this.exchanging = this._request("POST", "/api/v1/token", body, { auth: false })
        .catch((err) => {
          // a dead refresh token falls back to the key once
          if (this.refreshToken && err.code === "EAUTH") {
            this.refreshToken = undefined;
            return this._request("POST", "/api/v1/token", { apiKey: this.apiKey }, { auth: false });
          }
          throw err;
        })
        .then((tokens) => {
          this.accessToken = tokens.accessToken;
          this.refreshToken = tokens.refreshToken;
          this.expiresAt = Date.now() + tokens.expiresIn * 1000;
          return this.accessToken;
        })
        .finally(() => {
          this.exchanging = null;
        });
    }
    return this.exchanging;
  }

  async _request(method, path, body, { auth = true, retry = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${await this._bearer()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let res;
    try {
      res = await this.fetch(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      throw new DenisError(err.name === "AbortError" ? `request timed out after ${this.timeout} ms` : `request failed: ${err.message}`, err.name === "AbortError" ? "ETIMEOUT" : "ECONN");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new DenisError(`unexpected response (${res.status}) from ${path}`, "EPROTO", { status: res.status, body: text });
    }
    if (res.ok) return json;
    const error = json.error || {};
    // an expired access token is exchanged once more, then given up on
    if (res.status === 401 && auth && this.useJwt && retry) {
      this.expiresAt = 0;
      return this._request(method, path, body, { auth, retry: false });
    }
    const code = res.status === 401 ? "EAUTH" : res.status === 429 ? "ELIMIT" : "ESERVER";
    throw new DenisError(error.message || `HTTP ${res.status}`, code, { status: res.status, code: error.code, ...json });
  }

  /** Send one protocol line through the gateway and resolve with the engine's reply. */
  async command(line) {
    assertLine(line);
    const { reply } = await this._request("POST", "/api/v1/exec", { command: line });
    return reply;
  }

  /** Up to 50 commands in one request, answered in order; a failed command does not stop the rest. */
  async batch(lines) {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) throw new DenisError("batch takes 1-50 commands", "EINVAL");
    lines.forEach(assertLine);
    const { results } = await this._request("POST", "/api/v1/exec", { commands: lines });
    return results.map((r) => r.reply);
  }

  /** The database and scope behind the credential: { database: {id, name}, scope, via }. */
  async whoami() {
    return this._request("GET", "/api/v1/exec");
  }

  /** Storage, key and daily-command usage against the database's limits. */
  async usage() {
    return this._request("GET", "/api/v1/usage");
  }

  /** Nothing to close over HTTP; kept so code can treat both clients alike. */
  async close() {}
}

// ======================================================================= wiring

for (const [name, build] of Object.entries(COMMANDS)) {
  DenisCommands.prototype[name] = function (...args) {
    return this._run(build, args);
  };
}
for (const [name, build] of Object.entries(SESSION_COMMANDS)) {
  DenisClient.prototype[name] = function (...args) {
    return this._run(build, args);
  };
}
for (const [name, build] of Object.entries({ ...COMMANDS, ...SESSION_COMMANDS })) {
  DenisPipeline.prototype[name] = function (...args) {
    return this._add(build, args);
  };
}

module.exports = { DenisClient, DenisCloud, DenisCommands, DenisConnection, DenisError, DenisPipeline };

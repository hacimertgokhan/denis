"use strict";

/**
 * A thin, normalising layer over `denis-client`.
 *
 * The studio codes against the client API (`c.keys()`, `c.info()`, ...). The
 * client is evolving, so every operation checks whether the method exists
 * and, if not, falls back to `client.command(line)` with the documented
 * protocol line (docs/PROTOCOL.md). `command()` resolves with the parsed JSON
 * reply and never throws on `ok:false`; `expectOk()` turns such replies into
 * a StudioError carrying the server's error code.
 *
 * Results are normalised into plain shapes the UI relies on, whatever shape
 * the client returns (e.g. `keys()` may return an array or an object).
 * `api.fallbacks` records which operations had to use `command()` so the
 * status can be reported to the maintainer.
 */

class StudioError extends Error {
  constructor(message, code, reply) {
    super(message);
    this.name = "StudioError";
    this.code = code || "ERROR";
    if (reply !== undefined) this.reply = reply;
  }
}

/** Error codes that mean "the TCP connection is gone / unusable". */
const CONNECTION_CODES = new Set(["ECONN", "ECLOSED", "ETIMEOUT", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOTCONN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"]);

/** Map any error thrown by the client or the adapter to {message, code}. */
function normalizeError(err) {
  if (err instanceof StudioError) return err;
  if (!err || typeof err !== "object") return new StudioError(String(err), "ERROR");
  const reply = err.reply && typeof err.reply === "object" ? err.reply : undefined;
  // denis-client 1.1 (like 0.5) reports server errors as ESERVER / EAUTH with the server's code in
  // `serverCode` (= reply.code); the studio shows the server's code. A dropped connection stays a
  // connection error even when the server said why (LIMIT) before closing.
  const clientCode = typeof err.code === "string" ? err.code : "";
  const serverCode = (typeof err.serverCode === "string" && err.serverCode) || (reply && typeof reply.code === "string" && reply.code) || "";
  let code = CONNECTION_CODES.has(clientCode) ? clientCode : serverCode || clientCode || "ERROR";
  if (code === "EAUTH") code = "AUTH";
  if (code === "ESERVER") code = "ERROR";
  const message = (reply && typeof reply.error === "string" && reply.error) || err.message || String(err);
  return new StudioError(message, code, reply);
}

function isConnectionError(err) {
  const code = err && err.code;
  return typeof code === "string" && CONNECTION_CODES.has(code);
}

function stripOk(reply) {
  if (!reply || typeof reply !== "object") return reply;
  const { ok, ...rest } = reply;
  return rest;
}

/** SET flag values: no whitespace, no line breaks, no `-&` word (it would be read as a flag). */
function assertWireValue(value) {
  if (typeof value !== "string") throw new StudioError("value must be a string", "EINVAL");
  if (value.length === 0 || value.trim().length === 0) throw new StudioError("value must not be empty", "EINVAL");
  if (/[\r\n]/.test(value)) throw new StudioError("value must not contain line breaks", "EINVAL");
  if (/(^|\s)-&/.test(value)) throw new StudioError("value must not contain a word starting with -&", "EINVAL");
}

function assertKey(key) {
  if (typeof key !== "string" || key.length === 0 || /\s/.test(key)) {
    throw new StudioError(`key must be one word without spaces: ${JSON.stringify(key)}`, "EINVAL");
  }
}

const LAYER_FLAGS = { any: "", cache: " -&cache", persistent: " -&protobuff" };

/**
 * Split a dump into IMPORT payloads that each stay below `maxBytes` when
 * serialised (used only when the client has no `import()` of its own).
 * Keys are chunked freely; a table that does not fit is created by its first
 * line and continued with "append" lines (docs/PROTOCOL.md, IMPORT).
 */
function chunkDump(dump, { replace = false, maxBytes = 1024 * 1024 } = {}) {
  const chunks = [];
  let current = { cache: {}, persistent: {}, ttl: {} };
  let size = 64;
  const flush = () => {
    const hasData = Object.keys(current.cache).length || Object.keys(current.persistent).length || (current.tables && Object.keys(current.tables).length);
    if (hasData) {
      const out = { format: 1 };
      if (Object.keys(current.persistent).length) out.persistent = current.persistent;
      if (Object.keys(current.cache).length) out.cache = current.cache;
      if (Object.keys(current.ttl).length) out.ttl = current.ttl;
      if (current.tables) out.tables = current.tables;
      if (replace) out.replace = true;
      chunks.push(out);
    }
    current = { cache: {}, persistent: {}, ttl: {} };
    size = 64;
  };
  const add = (layer, key, value) => {
    const cost = Buffer.byteLength(JSON.stringify(key) + JSON.stringify(value)) + 4;
    if (size + cost > maxBytes && size > 64) flush();
    current[layer][key] = value;
    size += cost;
  };
  for (const [k, val] of Object.entries(dump.persistent || {})) add("persistent", k, val);
  const ttl = dump.ttl || {};
  for (const [k, val] of Object.entries(dump.cache || {})) {
    add("cache", k, val);
    if (ttl[k] !== undefined) {
      current.ttl[k] = ttl[k];
      size += 24;
    }
  }
  flush();
  for (const [name, def] of Object.entries(dump.tables || {})) {
    if (Buffer.byteLength(JSON.stringify(def)) <= maxBytes) {
      current.tables = { [name]: def };
      flush();
      continue;
    }
    // Too big for one line: the first line creates the table (with its indexes),
    // the next ones add rows with "append":true (never "replace", so a server
    // without append support fails safely with "Table already exists").
    let part = [];
    let partBytes = 0;
    let first = true;
    const emit = () => {
      if (first) {
        chunks.push({ format: 1, ...(replace ? { replace: true } : {}), tables: { [name]: { columns: def.columns, indexes: def.indexes || [], rows: part } } });
        first = false;
      } else {
        chunks.push({ format: 1, append: true, tables: { [name]: { columns: def.columns, rows: part } } });
      }
      part = [];
      partBytes = 0;
    };
    for (const row of def.rows || []) {
      const cost = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (partBytes + cost > maxBytes && part.length > 0) emit();
      part.push(row);
      partBytes += cost;
    }
    if (part.length > 0 || first) emit();
  }
  return chunks;
}

const DESCRIBE_STATEMENT = /^\s*(DESCRIBE|DESC)\s/i;

/**
 * A SQL result as the grid wants it: `columns` plus `rows` as arrays in that
 * order, or `affected`/`lastRowId`/`message` for a change.
 *
 * denis-client 1.1 (and the server) answer `{type:"rows", columns, rows:[{col: value}]}`,
 * `{type:"affected", affected, message, lastRowId}` or, for SHOW TABLES and DESCRIBE,
 * `{type:"tables", tables:[{name, columns:[{name, type, ...}], rows, indexes, bytes}]}`.
 * Replies without `type` (0.1 servers) carry rows as arrays already.
 */
function normalizeSqlResult(statement, r) {
  const out = {};
  if (r.type === "tables") {
    const tables = Array.isArray(r.tables) ? r.tables : [];
    if (DESCRIBE_STATEMENT.test(statement) && tables.length === 1) {
      out.columns = ["column", "type", "not_null", "primary_key", "unique", "default"];
      out.rows = (tables[0].columns || []).map((c) => [c.name, c.type ?? null, c.notNull === true, c.primaryKey === true, c.unique === true, c.default ?? null]);
    } else {
      out.columns = ["table", "rows", "columns", "indexes", "bytes"];
      out.rows = tables.map((t) => [
        t.name,
        t.rows ?? null,
        Array.isArray(t.columns) ? t.columns.length : null,
        Array.isArray(t.indexes) ? t.indexes.length : null,
        t.bytes ?? null,
      ]);
    }
    out.count = out.rows.length;
    return out;
  }
  const isResultSet = r.type === "rows" || (r.type === undefined && Array.isArray(r.columns) && r.columns.length > 0);
  if (isResultSet) {
    out.columns = (Array.isArray(r.columns) ? r.columns : []).map(String);
    const rows = Array.isArray(r.rows) ? r.rows : [];
    // row objects -> arrays in column order (the order the server listed the columns in)
    out.rows = rows.map((row) => (Array.isArray(row) ? row : out.columns.map((c) => (row && row[c] !== undefined ? row[c] : null))));
    out.count = r.count !== undefined && r.count !== null ? Number(r.count) : out.rows.length;
  }
  if (!isResultSet && r.affected !== undefined && r.affected !== null) out.affected = Number(r.affected);
  if (r.lastRowId !== undefined && r.lastRowId !== null) out.lastRowId = Number(r.lastRowId);
  if (typeof r.message === "string" && r.message) out.message = r.message;
  if (!isResultSet && out.message === undefined && typeof r.data === "string") out.message = r.data;
  return out;
}

function sumImported(total, part) {
  const src = (part && (part.imported || part)) || {};
  for (const k of ["persistent", "cache", "tables", "rows"]) {
    if (typeof src[k] === "number") total[k] = (total[k] || 0) + src[k];
  }
  return total;
}

/**
 * @param {object} client a DenisClient instance
 */
function createApi(client) {
  const fallbacks = new Set();
  const has = (name) => typeof client[name] === "function";
  /**
   * The rewritten client (with info/keys/query/dump) is "modern". The older
   * 0.0.x-style client has get/set/del but ignores options such as ttl, so it
   * is not trusted for anything but command().
   */
  const modern = ["info", "keys", "query", "dump", "whoami"].every(has);

  async function command(line) {
    try {
      return await client.command(line);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async function expectOk(line) {
    const reply = await command(line);
    if (!reply || reply.ok !== true) {
      const r = reply || {};
      throw new StudioError(r.error || r.message || "command failed", r.code || "ERROR", r);
    }
    return reply;
  }

  /** Use the client method when it exists (modern client), otherwise the fallback. */
  async function via(name, callMethod, fallback) {
    if (modern && has(name)) {
      try {
        return { value: await callMethod(), native: true };
      } catch (err) {
        throw normalizeError(err);
      }
    }
    fallbacks.add(name);
    return { value: await fallback(), native: false };
  }

  const api = {
    modern,
    fallbacks,
    command,
    expectOk,

    async hello() {
      const { value } = await via("hello", () => client.hello(), () => expectOk("HELLO"));
      return stripOk(value);
    },

    async ping() {
      const started = Date.now();
      const { value } = await via("ping", () => client.ping(), () => expectOk("PING"));
      if (value === false) throw new StudioError("PING failed", "ECONN");
      return Date.now() - started;
    },

    async whoami() {
      const { value } = await via("whoami", () => client.whoami(), () => expectOk("WHOAMI"));
      const r = stripOk(value) || {};
      return { group: r.group ?? null, admin: r.admin === true, project: r.project ?? null };
    },

    async info() {
      const { value } = await via("info", () => client.info(), () => expectOk("INFO"));
      const r = value && value.info && typeof value.info === "object" ? value.info : stripOk(value);
      return r || {};
    },

    async dbsize() {
      const { value } = await via("dbsize", () => client.dbsize(), () => expectOk("DBSIZE"));
      if (typeof value === "number") return { keys: value };
      return stripOk(value);
    },

    async projects() {
      const { value } = await via("projects", () => client.projects(), () => expectOk("PROJECTS"));
      const list = Array.isArray(value) ? value : (value && value.projects) || [];
      return list.map((p) => ({
        token: String(p.token),
        owner: p.owner ?? null,
        keys: Number(p.keys) || 0,
        tables: Number(p.tables) || 0,
        current: p.current === true,
      }));
    },

    async createProject() {
      const { value } = await via("createProject", () => client.createProject(), () => expectOk("AUTH CREATE"));
      const token = typeof value === "string" ? value : value && value.token;
      if (!token) throw new StudioError("server did not return a token", "EPROTO", value);
      return token;
    },

    async deleteProject(token) {
      await via("deleteProject", () => client.deleteProject(token), () => expectOk(`AUTH DELETE ${token}`));
      return true;
    },

    /** Switch the project of every pooled connection. Returns false when the client cannot (caller reconnects). */
    async use(token) {
      if (modern && has("use")) {
        try {
          await client.use(token);
          return true;
        } catch (err) {
          throw normalizeError(err);
        }
      }
      fallbacks.add("use");
      return false;
    },

    /**
     * @param {string} pattern glob
     * @param {{layer?: "any"|"cache"|"persistent", limit?: number}} [o]
     * @returns {Promise<{keys: string[], count: number, truncated: boolean}>}
     */
    async keys(pattern = "*", o = {}) {
      // Always the raw KEYS reply: the client's keys() returns a bare array and
      // drops "truncated", which the UI needs (the server caps the limit too).
      const layer = o.layer || "any";
      const limit = o.limit;
      const value = await expectOk(`KEYS ${pattern}${LAYER_FLAGS[layer] || ""}${limit ? ` -&limit=${limit}` : ""}`);
      const keys = (value && value.keys) || [];
      return { keys: keys.map(String), count: value.count ?? keys.length, truncated: value.truncated === true };
    },

    /**
     * Layers and TTL of each key. Uses EXISTS/TTL via command() on purpose:
     * the UI needs the per-layer flags of the full EXISTS reply, which a
     * boolean `exists()` would drop.
     */
    async keyMeta(keys) {
      return Promise.all(
        keys.map(async (key) => {
          const [ex, ttl] = await Promise.all([command(`EXISTS ${key}`), command(`TTL ${key}`)]);
          return {
            key,
            exists: ex && ex.ok ? ex.exists === true : false,
            cache: ex && ex.ok ? ex.cache === true : false,
            persistent: ex && ex.ok ? ex.persistent === true : false,
            ttl: ttl && ttl.ok ? Number(ttl.ttl ?? ttl.data) : null,
            ttlMillis: ttl && ttl.ok && ttl.ttlMillis !== undefined ? Number(ttl.ttlMillis) : null,
          };
        }),
      );
    },

    /**
     * Value of a key. source "persistent" prefers the durable value (the
     * server falls back to the cache value when there is none).
     * @returns {Promise<string|null>}
     */
    async get(key, o = {}) {
      assertKey(key);
      const source = o.source === "persistent" ? "protobuf" : o.source === "cache" ? "cache" : undefined;
      if (modern && has("get")) {
        try {
          const value = await client.get(key, source ? { source } : undefined);
          return value === undefined ? null : value;
        } catch (err) {
          const e = normalizeError(err);
          if (e.code === "NOTFOUND") return null;
          throw e;
        }
      }
      fallbacks.add("get");
      const reply = await command(`GET ${key}${source === "protobuf" ? " -&from-protobuff" : ""}`);
      if (reply.ok) return reply.data ?? null;
      if (reply.code === "NOTFOUND" || reply.error === "not found") return null;
      throw new StudioError(reply.error || "GET failed", reply.code || "ERROR", reply);
    },

    /** @param {{persist?: boolean, ttl?: number}} [o] */
    async set(key, value, o = {}) {
      assertKey(key);
      assertWireValue(value);
      const ttl = o.ttl && o.ttl > 0 ? o.ttl : undefined;
      await via(
        "set",
        () => client.set(key, value, { persist: !!o.persist, ...(ttl ? { ttl } : {}) }),
        () => expectOk(`SET ${key} ${value}${o.persist ? " -&save" : ""}${ttl ? ` -&ttl=${ttl}` : ""}`),
      );
      return true;
    },

    /** @param {"both"|"cache"|"persistent"} layer */
    async del(key, layer = "both") {
      assertKey(key);
      const opts = layer === "cache" ? { cache: true } : layer === "persistent" ? { protobuf: true } : {};
      const flag = layer === "cache" ? " -&cache" : layer === "persistent" ? " -&protobuff" : "";
      const { value } = await via("del", () => client.del(key, opts), () => expectOk(`DEL ${key}${flag}`));
      if (value && typeof value === "object" && typeof value.deleted === "boolean") return value.deleted;
      return typeof value === "boolean" ? value : true;
    },

    async exists(key) {
      assertKey(key);
      const [meta] = await api.keyMeta([key]);
      return meta;
    },

    async incr(key, delta = 1, o = {}) {
      assertKey(key);
      const { value } = await via(
        "incr",
        () => client.incr(key, delta, { persist: !!o.persist }),
        () => expectOk(`INCR ${key} ${delta}${o.persist ? " -&save" : ""}`),
      );
      if (typeof value === "number") return value;
      if (typeof value === "string") return Number(value);
      return Number(value.value ?? value.data);
    },

    async expire(key, seconds) {
      assertKey(key);
      const { value } = await via("expire", () => client.expire(key, seconds), () => expectOk(`EXPIRE ${key} ${seconds}`));
      return typeof value === "boolean" ? value : value && typeof value === "object" ? value.updated !== false : true;
    },

    async persist(key) {
      assertKey(key);
      const { value } = await via("persist", () => client.persist(key), () => expectOk(`PERSIST ${key}`));
      return typeof value === "boolean" ? value : value && typeof value === "object" ? value.updated !== false : true;
    },

    async ttl(key) {
      assertKey(key);
      const { value } = await via("ttl", () => client.ttl(key), () => expectOk(`TTL ${key}`));
      if (typeof value === "number") return value;
      return Number(value.ttl ?? value.data);
    },

    async clearCache() {
      await via("clear", () => client.clear(), () => expectOk("HEAVEN"));
      return true;
    },

    /**
     * Run one SQL statement with bound parameters (always sent as QUERY {"sql","params"},
     * so the statement may span lines). The result is shaped for the grid: rows are
     * arrays in the order of `columns`.
     * @returns {Promise<{columns?: string[], rows?: any[][], count?: number, affected?: number, lastRowId?: number, message?: string}>}
     */
    async query(sql, params = []) {
      const { value } = await via(
        "sql",
        () => client.sql(sql, params),
        () => expectOk(`QUERY ${JSON.stringify({ sql, params })}`),
      );
      return normalizeSqlResult(sql, stripOk(value) || {});
    },

    async dump() {
      const { value } = await via("dump", () => client.dump(), () => expectOk("DUMP"));
      const d = stripOk(value) || {};
      return d;
    },

    /**
     * Import a dump. Progress callback gets {done, total} (chunks) when known.
     * @returns {Promise<{persistent: number, cache: number, tables: number, rows: number}>}
     */
    async import(dump, o = {}) {
      const replace = !!o.replace;
      const onProgress = typeof o.onProgress === "function" ? o.onProgress : () => {};
      if (modern && has("import")) {
        onProgress({ done: 0, total: null });
        try {
          const result = await client.import(dump, { replace, onProgress: (p) => onProgress(normalizeProgress(p)) });
          const total = Array.isArray(result) ? result.reduce(sumImported, {}) : sumImported({}, result);
          onProgress({ done: 1, total: 1 });
          return { persistent: 0, cache: 0, tables: 0, rows: 0, ...total };
        } catch (err) {
          const e = normalizeError(err);
          const partial = err && err.imported;
          if (partial && typeof partial === "object") {
            e.imported = partial;
            e.message += ` (imported before the error: ${partial.persistent || 0} durable keys, ${partial.cache || 0} cache keys, ${partial.tables || 0} tables, ${partial.rows || 0} rows)`;
          }
          throw e;
        }
      }
      fallbacks.add("import");
      const chunks = chunkDump(dump, { replace, ...(o.maxBytes ? { maxBytes: o.maxBytes } : {}) });
      const total = { persistent: 0, cache: 0, tables: 0, rows: 0 };
      onProgress({ done: 0, total: chunks.length });
      for (let i = 0; i < chunks.length; i++) {
        const reply = await expectOk(`IMPORT ${JSON.stringify(chunks[i])}`);
        sumImported(total, reply);
        onProgress({ done: i + 1, total: chunks.length });
      }
      return total;
    },

    /** SAVE -> {message, bytes, records, millis}; the raw reply, since the client's save() resolves to true. */
    async save() {
      return stripOk(await expectOk("SAVE"));
    },

    async backup() {
      const { value } = await via("backup", () => client.backup(), () => expectOk("BACKUP"));
      return stripOk(value);
    },

    async backups() {
      const { value } = await via("backups", () => client.backups(), () => expectOk("BACKUPS"));
      const list = Array.isArray(value) ? value : (value && value.backups) || [];
      return {
        directory: (value && !Array.isArray(value) && value.directory) || null,
        backups: list.map((b) => ({ name: String(b.name), path: b.path ?? null, bytes: Number(b.bytes) || 0, createdAt: b.createdAt ?? null })),
      };
    },
  };
  return api;
}

function normalizeProgress(p) {
  if (!p || typeof p !== "object") return { done: 0, total: null };
  const done = Number(p.done ?? p.sent ?? p.chunk ?? 0);
  const total = p.total ?? p.chunks ?? null;
  return { done: Number.isFinite(done) ? done : 0, total: total === null ? null : Number(total) };
}

module.exports = { createApi, StudioError, normalizeError, normalizeSqlResult, isConnectionError, chunkDump, assertWireValue, CONNECTION_CODES };

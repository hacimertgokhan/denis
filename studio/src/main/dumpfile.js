"use strict";

/**
 * `.denis.json` files: a logical export of one project.
 *
 *   {
 *     "kind": "denis-studio-export",
 *     "formatVersion": 1,
 *     "exportedAt": "2026-09-23T18:00:00.000Z",
 *     "studio": { "version": "0.1.0" },
 *     "source": { "host", "port", "group", "project": "abcd1234…", "serverVersion" },
 *     "summary": { "cacheKeys", "persistentKeys", "ttlKeys", "tables", "rows" },
 *     "dump": { "format": 1, "server": "denis", "version", "createdAt",
 *               "cache": {}, "persistent": {}, "ttl": {}, "tables": {} }
 *   }
 *
 * `dump` is the DUMP reply without `ok` and is exactly what IMPORT accepts.
 * A raw DUMP object (as written by other tools) is accepted on import, too.
 * The project token is shortened in the metadata: the file identifies where
 * the data came from without carrying the credential.
 *
 * TTLs in `dump.ttl` are milliseconds remaining at export time; on import they
 * start counting again from the moment of the import.
 */

const KIND = "denis-studio-export";
const FORMAT_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

class DumpFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "DumpFileError";
    this.code = "EFORMAT";
  }
}

function shortToken(token) {
  if (!token) return null;
  const t = String(token);
  return t.length <= 12 ? t : `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** DUMP reply -> the object IMPORT accepts (no `ok`, known sections only). */
function cleanDump(dump) {
  if (!isPlainObject(dump)) throw new DumpFileError("dump must be an object");
  const out = {
    format: dump.format ?? 1,
    server: dump.server ?? "denis",
    version: dump.version ?? null,
    createdAt: dump.createdAt ?? null,
    cache: isPlainObject(dump.cache) ? dump.cache : {},
    persistent: isPlainObject(dump.persistent) ? dump.persistent : {},
    ttl: isPlainObject(dump.ttl) ? dump.ttl : {},
    tables: isPlainObject(dump.tables) ? dump.tables : {},
  };
  return out;
}

/** Counts shown in the export result and the import preview. */
function summarize(dump) {
  const d = cleanDump(dump);
  const tables = Object.entries(d.tables).map(([name, def]) => ({
    name,
    columns: Array.isArray(def.columns) ? def.columns.length : 0,
    rows: Array.isArray(def.rows) ? def.rows.length : 0,
    indexes: Array.isArray(def.indexes) ? def.indexes.length : 0,
  }));
  const keys = new Set([...Object.keys(d.cache), ...Object.keys(d.persistent)]);
  return {
    keys: keys.size,
    cacheKeys: Object.keys(d.cache).length,
    persistentKeys: Object.keys(d.persistent).length,
    ttlKeys: Object.keys(d.ttl).length,
    tables: tables.length,
    rows: tables.reduce((n, t) => n + t.rows, 0),
    tableList: tables,
  };
}

/**
 * Wrap a DUMP reply with metadata for saving.
 * @param {object} dump  DUMP reply (with or without ok)
 * @param {{host?: string, port?: number, group?: string, project?: string, serverVersion?: string, studioVersion?: string, now?: Date}} meta
 */
function wrapDump(dump, meta = {}) {
  const clean = cleanDump(dump);
  const { tableList, ...counts } = summarize(clean);
  return {
    kind: KIND,
    formatVersion: FORMAT_VERSION,
    exportedAt: (meta.now || new Date()).toISOString(),
    studio: { version: meta.studioVersion ?? null },
    source: {
      host: meta.host ?? null,
      port: meta.port ?? null,
      group: meta.group ?? null,
      project: shortToken(meta.project),
      serverVersion: meta.serverVersion ?? clean.version ?? null,
    },
    summary: counts,
    dump: clean,
  };
}

function serialize(file) {
  return JSON.stringify(file, null, 1) + "\n";
}

function validateTables(tables) {
  for (const [name, def] of Object.entries(tables)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new DumpFileError(`table name "${name}" is not valid`);
    if (!isPlainObject(def)) throw new DumpFileError(`table "${name}" must be an object`);
    if (!Array.isArray(def.columns) || def.columns.length === 0) throw new DumpFileError(`table "${name}" has no "columns" array`);
    for (const c of def.columns) {
      if (!isPlainObject(c) || typeof c.name !== "string" || typeof c.type !== "string") {
        throw new DumpFileError(`table "${name}" has a column without "name"/"type"`);
      }
    }
    if (def.rows !== undefined && !Array.isArray(def.rows)) throw new DumpFileError(`table "${name}": "rows" must be an array`);
    for (const [i, row] of (def.rows || []).entries()) {
      if (!Array.isArray(row)) throw new DumpFileError(`table "${name}": row ${i} is not an array`);
    }
    if (def.indexes !== undefined && !Array.isArray(def.indexes)) throw new DumpFileError(`table "${name}": "indexes" must be an array`);
  }
}

function validateKeys(section, map) {
  for (const [key, value] of Object.entries(map)) {
    if (key.length === 0 || /\s/.test(key)) throw new DumpFileError(`${section} key ${JSON.stringify(key)} is not one word`);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new DumpFileError(`${section} value of "${key}" must be a string`);
    }
  }
}

/**
 * Parse file content. Accepts the studio wrapper or a raw DUMP object.
 * @returns {{meta: object|null, dump: object, summary: object}}
 */
function parseDumpFile(text) {
  if (typeof text !== "string") throw new DumpFileError("file content must be text");
  let data;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new DumpFileError(`not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(data)) throw new DumpFileError("file must contain a JSON object");
  let meta = null;
  let raw;
  if (data.kind === KIND) {
    if (typeof data.formatVersion !== "number" || data.formatVersion > FORMAT_VERSION) {
      throw new DumpFileError(`unsupported export format version ${data.formatVersion}; update Denis Studio`);
    }
    meta = { exportedAt: data.exportedAt ?? null, source: isPlainObject(data.source) ? data.source : {}, studio: data.studio ?? null };
    raw = data.dump;
  } else if ("cache" in data || "persistent" in data || "tables" in data || "ttl" in data) {
    raw = data;
  } else {
    throw new DumpFileError("this is not a Denis export (.denis.json) or DUMP file");
  }
  if (!isPlainObject(raw)) throw new DumpFileError('"dump" section is missing');
  if (raw.format !== undefined && raw.format !== 1) throw new DumpFileError(`unsupported dump format ${raw.format}`);
  for (const section of ["cache", "persistent", "ttl", "tables"]) {
    if (raw[section] !== undefined && !isPlainObject(raw[section])) throw new DumpFileError(`"${section}" must be an object`);
  }
  const dump = cleanDump(raw);
  validateKeys("cache", dump.cache);
  validateKeys("persistent", dump.persistent);
  for (const [key, ms] of Object.entries(dump.ttl)) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw new DumpFileError(`ttl of "${key}" must be a non-negative number of milliseconds`);
  }
  validateTables(dump.tables);
  return { meta, dump, summary: summarize(dump) };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** e.g. denis-7dMs9h2f-20260923-180441.denis.json */
function suggestFileName(project, date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const id = project ? String(project).replace(/[^A-Za-z0-9]/g, "").slice(0, 8) : "project";
  return `denis-${id}-${stamp}.denis.json`;
}

module.exports = { KIND, FORMAT_VERSION, MAX_FILE_BYTES, DumpFileError, wrapDump, parseDumpFile, summarize, serialize, suggestFileName, shortToken, cleanDump };

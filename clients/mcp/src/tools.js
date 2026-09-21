import { z } from "zod";
import { DenisError } from "denis-client";
import { failure, result, rowsToMarkdown, tablesToMarkdown } from "./format.js";

const KEY = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/, "keys are one word: no whitespace")
  .describe("Key name; one word without whitespace, e.g. \"user:42\"");

const FORMAT = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Text rendering of the result: 'markdown' (compact, readable) or 'json' (complete)");

const READ_ONLY_SQL = /^\s*(SQL\s+)?(SELECT|SHOW|DESCRIBE|DESC)\b/i;

export function isReadOnlySql(sql) {
  return READ_ONLY_SQL.test(sql);
}

/** Convert a DenisError (or anything else) into an MCP error result. */
function fromError(err) {
  if (err instanceof DenisError) {
    switch (err.code) {
      case "ECONN":
      case "ETIMEOUT":
        return failure(err.message, "Is the Denis server running and reachable at DENIS_HOST:DENIS_PORT?");
      case "EAUTH":
        return failure(err.message, "Check DENIS_GROUP / DENIS_PASSWORD / DENIS_TOKEN.");
      case "ESERVER":
        return failure(err.message, /Table not found/.test(err.message) ? "Call denis_describe to list the existing tables." : undefined);
      default:
        return failure(err.message);
    }
  }
  return failure(err?.message || String(err));
}

/** Try to interpret a stored value as JSON; fall back to the raw string. */
function parseValue(value) {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}

/** The schema overview shared by denis_describe and the denis://schema resource. */
export async function describeProject(denis, sampleKeys = 50) {
  const [info, tables, keys] = await Promise.all([denis.info(), denis.tables(), denis.keys("*")]);
  return {
    server: { version: info.version, uptimeSeconds: info.uptimeSeconds },
    project: { cachedKeys: info.project?.cachedKeys ?? 0, persistedKeys: info.project?.persistedKeys ?? 0 },
    tables,
    keys: { total: keys.length, sample: keys.slice(0, sampleKeys) },
  };
}

export function schemaToMarkdown(schema) {
  const lines = [
    `# Denis project overview (server ${schema.server.version})`,
    "",
    "## SQL tables",
    tablesToMarkdown(schema.tables),
    "",
    `## Key-value keys (${schema.keys.total} total, ${schema.project.persistedKeys} persisted)`,
    schema.keys.sample.length === 0 ? "_no keys_" : schema.keys.sample.map((k) => `- ${k}`).join("\n"),
  ];
  if (schema.keys.total > schema.keys.sample.length) {
    lines.push(`- … ${schema.keys.total - schema.keys.sample.length} more (use denis_keys with a pattern)`);
  }
  return lines.join("\n");
}

/**
 * Register every tool on the server.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("denis-client").DenisClient} denis
 * @param {{ readOnly: boolean, maxRows: number }} config
 */
export function registerTools(server, denis, config) {
  server.registerTool(
    "denis_describe",
    {
      title: "Describe the Denis project",
      description: `Overview of what is stored in the current Denis project: every SQL table with its columns and row count, the number of key-value keys with a sample, and the server version.

Call this first, before writing any SQL, so the query uses the real table and column names.

Returns: { server: {version, uptimeSeconds}, project: {cachedKeys, persistedKeys}, tables: [{name, columns: [{name, type}], rows}], keys: {total, sample: [string]} }`,
      inputSchema: {
        sample_keys: z.number().int().min(0).max(500).default(50).describe("How many key names to include in the sample"),
        response_format: FORMAT,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sample_keys, response_format }) => {
      try {
        const schema = await describeProject(denis, sample_keys);
        const text = response_format === "json" ? JSON.stringify(schema, null, 2) : schemaToMarkdown(schema);
        return result(text, schema);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_query",
    {
      title: "Run a read-only SQL query",
      description: `Run a SELECT, SHOW TABLES or DESCRIBE <table> statement against the project's SQL tables and return the rows.

Dialect (single table, no joins/subqueries/GROUP BY):
  SELECT cols | * | COUNT(*) FROM t [WHERE a = 1 AND b LIKE 'x%' OR c IS NULL] [ORDER BY col [ASC|DESC]] [LIMIT n [OFFSET m]]
  WHERE operators: = != <> < <= > >= LIKE IS NULL IS NOT NULL; AND binds tighter than OR; no parentheses.
  Strings use single quotes; numbers, true/false and NULL are bare.

Rows are capped at 'limit' (default ${config.maxRows}); add ORDER BY and LIMIT/OFFSET to the SQL to page through big tables.
Statements that modify data are refused here; use denis_execute for those.

Returns: { type: "rows", columns: [string], rows: [object], count: number, truncated: boolean }`,
      inputSchema: {
        sql: z.string().min(1).max(10_000).describe("One SQL statement, e.g. \"SELECT name, price FROM products WHERE price > 10 ORDER BY price DESC LIMIT 20\""),
        limit: z.number().int().min(1).max(5_000).default(config.maxRows).describe("Maximum rows to return"),
        response_format: FORMAT,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sql, limit, response_format }) => {
      if (!isReadOnlySql(sql)) {
        return failure("denis_query only runs SELECT / SHOW TABLES / DESCRIBE", "Use denis_execute for INSERT, UPDATE, DELETE, CREATE TABLE and DROP TABLE.");
      }
      if (/[\r\n]/.test(sql)) sql = sql.replace(/\s*[\r\n]+\s*/g, " ");
      try {
        const res = await denis.sql(sql);
        if (res.type === "tables") {
          const text = response_format === "json" ? JSON.stringify(res, null, 2) : tablesToMarkdown(res.tables);
          return result(text, res);
        }
        const truncated = res.rows.length > limit;
        const rows = truncated ? res.rows.slice(0, limit) : res.rows;
        const output = { type: "rows", columns: res.columns, rows, count: rows.length, total: res.count, truncated };
        let text = response_format === "json" ? JSON.stringify(output, null, 2) : rowsToMarkdown(res.columns, rows);
        if (truncated && response_format !== "json") {
          text += `\n\n_${rows.length} of ${res.count} rows shown; add LIMIT/OFFSET or a WHERE clause to see the rest._`;
        }
        return result(text, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_get",
    {
      title: "Get a key",
      description: `Read one key-value entry of the project. Values are stored as text; when the text is JSON it is also returned parsed.

Returns: { key, found: boolean, value: string | null, parsed?: object }`,
      inputSchema: { key: KEY },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ key }) => {
      try {
        const value = await denis.get(key);
        const parsed = parseValue(value);
        const output = { key, found: value !== null, value, ...(parsed !== value && parsed !== null ? { parsed } : {}) };
        const text = value === null ? `Key "${key}" not found.` : typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : value;
        return result(text, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_mget",
    {
      title: "Get several keys",
      description: `Read up to 100 keys in one call. Missing keys map to null.

Returns: { values: { [key]: string | null } }`,
      inputSchema: { keys: z.array(KEY).min(1).max(100).describe("Keys to read") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ keys }) => {
      try {
        const values = await denis.mget(keys);
        const text = Object.entries(values)
          .map(([k, v]) => `${k}: ${v === null ? "(missing)" : v}`)
          .join("\n");
        return result(text, { values });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_keys",
    {
      title: "List keys",
      description: `List the project's key names matching a glob pattern (* = any run of characters, ? = one character). Internal SQL storage keys are hidden.

Returns: { pattern, total: number, count: number, keys: [string], truncated: boolean }`,
      inputSchema: {
        pattern: z.string().min(1).max(256).regex(/^\S+$/).default("*").describe("Glob pattern, e.g. \"user:*\""),
        limit: z.number().int().min(1).max(5_000).default(200).describe("Maximum key names to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pattern, limit }) => {
      try {
        const all = await denis.keys(pattern);
        const keys = all.slice(0, limit);
        const output = { pattern, total: all.length, count: keys.length, keys, truncated: all.length > keys.length };
        const text = keys.length === 0 ? `No keys match "${pattern}".` : keys.join("\n") + (output.truncated ? `\n… ${all.length - keys.length} more` : "");
        return result(text, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_info",
    {
      title: "Server status",
      description: `Statistics of the Denis server: version, uptime, open/total connections, commands handled, cached and persisted key counts, memory.

Returns: the server's INFO object.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const info = await denis.info();
        return result(JSON.stringify(info, null, 2), info);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  if (config.readOnly) {
    return;
  }

  server.registerTool(
    "denis_execute",
    {
      title: "Run a modifying SQL statement",
      description: `Run INSERT, UPDATE, DELETE, CREATE TABLE or DROP TABLE on the project's SQL tables. Tables are persisted to disk.

Dialect:
  CREATE TABLE [IF NOT EXISTS] t (col TYPE, ...)        types are informational (INT, REAL, TEXT, BOOL, ...)
  INSERT INTO t (cols) VALUES (vals) [, (vals) ...]      multi-row inserts are supported
  UPDATE t SET col = v [, ...] [WHERE ...]
  DELETE FROM t [WHERE ...]                              no WHERE deletes every row
  DROP TABLE [IF EXISTS] t

Use denis_query for SELECT. Call denis_describe first to see which tables exist.

Returns: { type: "affected", affected: number, message: string }`,
      inputSchema: {
        sql: z.string().min(1).max(50_000).describe("One SQL statement, e.g. \"INSERT INTO products (id, name, price) VALUES (1, 'Pen', 2.5)\""),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ sql }) => {
      if (isReadOnlySql(sql)) {
        return failure("denis_execute is for statements that modify data", "Use denis_query for SELECT / SHOW TABLES / DESCRIBE.");
      }
      if (/[\r\n]/.test(sql)) sql = sql.replace(/\s*[\r\n]+\s*/g, " ");
      try {
        const res = await denis.sql(sql);
        return result(res.message ? `OK: ${res.message}` : JSON.stringify(res), res);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_set",
    {
      title: "Set a key",
      description: `Write one key-value entry. Objects and arrays are stored as JSON text. By default the value is persisted to disk (survives a restart); pass persist=false for a cache-only entry.

Returns: { key, persisted: boolean }`,
      inputSchema: {
        key: KEY,
        value: z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown()), z.array(z.unknown())]).describe("Value; non-strings are JSON-encoded"),
        persist: z.boolean().default(true).describe("Also write to the persisted store (default true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ key, value, persist }) => {
      try {
        await denis.set(key, typeof value === "string" ? value : JSON.stringify(value), { persist });
        return result(`Stored "${key}"${persist ? " (persisted)" : " (cache only)"}.`, { key, persisted: persist });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_delete",
    {
      title: "Delete a key",
      description: `Remove one key from both the cache and the persisted store.

Returns: { key, deleted: true }`,
      inputSchema: { key: KEY },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ key }) => {
      try {
        await denis.del(key);
        return result(`Deleted "${key}".`, { key, deleted: true });
      } catch (err) {
        return fromError(err);
      }
    },
  );
}

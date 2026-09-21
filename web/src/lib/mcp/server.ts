import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DenisReply } from "@/lib/denis/client";
import { runCommand, type DatabaseRow } from "@/lib/databases";
import type { Principal } from "@/lib/api-keys";
import { plan } from "@/lib/env";

/**
 * The hosted MCP server: the same tools as clients/mcp, but every call goes
 * through the platform gateway (ownership, scope, daily budget, metering) with
 * the caller's API key. One McpServer is built per request (stateless
 * Streamable HTTP), which is cheap: registration is a handful of closures.
 */

const KEY = z.string().min(1).max(512).regex(/^\S+$/, "keys are one word").describe("Key name, one word without whitespace");
const FORMAT = z.enum(["markdown", "json"]).default("markdown").describe("Text rendering: markdown (compact) or json (complete)");
const READ_ONLY_SQL = /^\s*(SQL\s+)?(SELECT|SHOW|DESCRIBE|DESC)\b/i;
const CHARACTER_LIMIT = 25_000;

type Row = Record<string, unknown>;
type TableInfo = { name: string; columns: { name: string; type: string }[]; rows: number };

function text(value: string) {
  return value.length > CHARACTER_LIMIT ? value.slice(0, CHARACTER_LIMIT) + "\n\n_[truncated]_" : value;
}

function result(value: string, structured: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: text(value) }], structuredContent: structured };
}

function failure(message: string, hint?: string) {
  return { isError: true, content: [{ type: "text" as const, text: hint ? `Error: ${message}\nHint: ${hint}` : `Error: ${message}` }] };
}

function rowsToMarkdown(columns: string[], rows: Row[]) {
  if (rows.length === 0) return "_no rows_";
  const names = columns.length ? columns : Object.keys(rows[0]);
  const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v).replace(/\|/g, "\\|"));
  return [`| ${names.join(" | ")} |`, `| ${names.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${names.map((n) => cell(r[n])).join(" | ")} |`)].join(
    "\n",
  );
}

function tablesToMarkdown(tables: TableInfo[]) {
  if (tables.length === 0) return "_no tables_";
  return tables.map((t) => `- **${t.name}** (${t.rows} rows): ${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}`).join("\n");
}

export function createMcpServer(principal: Principal) {
  const database: DatabaseRow = principal.database;
  const readOnly = principal.scope === "read";
  const server = new McpServer({ name: "denis-cloud", version: "1.0.0" });

  const actor = { type: "apikey" as const, id: principal.keyId, label: principal.keyName };
  const run = (line: string) => runCommand(database, line, { readOnly, source: "mcp", actor }).then((r) => r.reply);
  const fromError = (err: unknown) => {
    const e = err as { message?: string; code?: string };
    if (e.code === "READ_ONLY") return failure(String(e.message), "Use an API key with write scope for changes.");
    if (e.code === "OPS_QUOTA") return failure(String(e.message), "The daily command budget resets at 00:00 UTC.");
    return failure(String(e.message ?? err));
  };
  const serverError = (reply: DenisReply) => {
    const message = String(reply.error ?? "command failed");
    if (reply.code === "QUOTA")
      return failure(message, `The database reached its storage limit (${plan().dbMaxKeys} keys / ${plan().dbMaxBytes} bytes). Delete data or drop tables.`);
    if (/Table not found/.test(message)) return failure(message, "Call denis_describe to list the existing tables.");
    return failure(message);
  };

  server.registerTool(
    "denis_describe",
    {
      title: "Describe the database",
      description: `Overview of the database "${database.name}": every SQL table with columns and row counts, the number of key-value keys with a sample, and the storage used against the quota. Call this first, before writing SQL, so queries use the real table and column names.

Returns: { tables: [{name, columns: [{name, type}], rows}], keys: {total, sample: [string]}, usage: {persistedKeys, persistedBytes, maxKeys, maxBytes} }`,
      inputSchema: { sample_keys: z.number().int().min(0).max(500).default(50), response_format: FORMAT },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sample_keys, response_format }) => {
      try {
        const [tables, keys, info] = await Promise.all([run("SHOW TABLES"), run("KEYS *"), run("INFO")]);
        if (!tables.ok) return serverError(tables);
        const project = (info.project ?? {}) as Record<string, number>;
        const allKeys = (keys.keys as string[]) ?? [];
        const overview = {
          database: database.name,
          tables: (tables.tables as TableInfo[]) ?? [],
          keys: { total: allKeys.length, sample: allKeys.slice(0, sample_keys) },
          usage: {
            persistedKeys: project.persistedKeys ?? 0,
            persistedBytes: project.persistedBytes ?? 0,
            maxKeys: database.maxKeys,
            maxBytes: database.maxBytes,
          },
        };
        if (response_format === "json") return result(JSON.stringify(overview, null, 2), overview);
        const md = [
          `# ${database.name}`,
          "",
          "## SQL tables",
          tablesToMarkdown(overview.tables),
          "",
          `## Keys (${overview.keys.total} total)`,
          overview.keys.sample.length ? overview.keys.sample.map((k) => `- ${k}`).join("\n") : "_no keys_",
          "",
          `Storage: ${overview.usage.persistedKeys}/${overview.usage.maxKeys} keys, ${overview.usage.persistedBytes}/${overview.usage.maxBytes} bytes`,
        ].join("\n");
        return result(md, overview);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_query",
    {
      title: "Run a read-only SQL query",
      description: `Run SELECT, SHOW TABLES or DESCRIBE <table> and return the rows.

Dialect (single table, no joins/subqueries/GROUP BY):
  SELECT cols | * | COUNT(*) FROM t [WHERE a = 1 AND b LIKE 'x%' OR c IS NULL] [ORDER BY col [ASC|DESC]] [LIMIT n [OFFSET m]]
  Operators: = != <> < <= > >= LIKE IS NULL IS NOT NULL; AND binds tighter than OR; strings in single quotes.
Modifying statements are refused; use denis_execute.

Returns: { type: "rows", columns: [string], rows: [object], count: number, truncated: boolean }`,
      inputSchema: {
        sql: z.string().min(1).max(10_000).describe("One SQL statement"),
        limit: z.number().int().min(1).max(5000).default(200).describe("Maximum rows to return"),
        response_format: FORMAT,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sql, limit, response_format }) => {
      if (!READ_ONLY_SQL.test(sql))
        return failure("denis_query only runs SELECT / SHOW TABLES / DESCRIBE", "Use denis_execute for INSERT, UPDATE, DELETE, CREATE TABLE and DROP TABLE.");
      try {
        const reply = await run(sql.replace(/\s*[\r\n]+\s*/g, " "));
        if (!reply.ok) return serverError(reply);
        if (reply.type === "tables") {
          const tables = reply.tables as TableInfo[];
          return result(response_format === "json" ? JSON.stringify(tables, null, 2) : tablesToMarkdown(tables), { type: "tables", tables });
        }
        const all = (reply.rows as Row[]) ?? [];
        const rows = all.slice(0, limit);
        const columns = (reply.columns as string[]) ?? [];
        const output = { type: "rows", columns, rows, count: rows.length, total: all.length, truncated: all.length > rows.length };
        let md = response_format === "json" ? JSON.stringify(output, null, 2) : rowsToMarkdown(columns, rows);
        if (output.truncated && response_format !== "json") md += `\n\n_${rows.length} of ${all.length} rows shown; add LIMIT/OFFSET or a WHERE clause._`;
        return result(md, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_get",
    {
      title: "Get a key",
      description: "Read one key-value entry. JSON values are also returned parsed.\n\nReturns: { key, found, value, parsed? }",
      inputSchema: { key: KEY },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ key }) => {
      try {
        const reply = await run(`GET ${key}`);
        if (!reply.ok && reply.error !== "not found") return serverError(reply);
        const value = reply.ok ? String(reply.data) : null;
        let parsed: unknown = undefined;
        if (value !== null) {
          try {
            const p = JSON.parse(value);
            if (typeof p === "object") parsed = p;
          } catch {
            // plain text
          }
        }
        const output = { key, found: value !== null, value, ...(parsed !== undefined ? { parsed } : {}) };
        return result(value === null ? `Key "${key}" not found.` : parsed !== undefined ? JSON.stringify(parsed, null, 2) : value, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_mget",
    {
      title: "Get several keys",
      description: "Read up to 100 keys at once; missing keys map to null.\n\nReturns: { values: { [key]: string | null } }",
      inputSchema: { keys: z.array(KEY).min(1).max(100) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ keys }) => {
      try {
        const reply = await run(`MGET ${keys.join(" ")}`);
        if (!reply.ok) return serverError(reply);
        const values = reply.values as Record<string, string | null>;
        return result(
          Object.entries(values)
            .map(([k, v]) => `${k}: ${v === null ? "(missing)" : v}`)
            .join("\n"),
          { values },
        );
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_keys",
    {
      title: "List keys",
      description: "Key names matching a glob (* any run, ? one character). Returns: { pattern, total, count, keys, truncated }",
      inputSchema: { pattern: z.string().min(1).max(256).regex(/^\S+$/).default("*"), limit: z.number().int().min(1).max(5000).default(200) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pattern, limit }) => {
      try {
        const reply = await run(`KEYS ${pattern}`);
        if (!reply.ok) return serverError(reply);
        const all = reply.keys as string[];
        const keys = all.slice(0, limit);
        const output = { pattern, total: all.length, count: keys.length, keys, truncated: all.length > keys.length };
        return result(keys.length ? keys.join("\n") + (output.truncated ? `\n… ${all.length - keys.length} more` : "") : `No keys match "${pattern}".`, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_graph",
    {
      title: "Fetch a graph of reads in one call",
      description:
        "Run a QUERY document: several reads shaped like GraphQL, resolved in one round trip. Fields: alias: resolver(args) { selection }. " +
        'Resolvers (read-only): get(key), mget(k1, k2), prefix("cart:1:"), keys(pattern), exists(key), count(table), ' +
        'table(name, where: "...", order: "col desc", limit: n, offset: n), sql("SELECT ..."), tables(), describe(table). ' +
        "A selection { a b { c } } parses a JSON value or projects row columns; on table() it becomes the SELECT list. " +
        'Example: { user: get("user:1") { name email } orders: table("orders", where: "user_id = 1", limit: 5) { id total } n: count("orders") }\n\n' +
        "Returns: { data: { [alias]: value }, errors?: [{ path, error }] } — a failing field is null with an error, the rest still resolve.",
      inputSchema: { document: z.string().min(2).max(16000) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ document }) => {
      try {
        const reply = await run(`QUERY ${document.replace(/[\r\n]+/g, " ")}`);
        if (!reply.ok) return serverError(reply);
        const output = {
          data: reply.data as unknown as Record<string, unknown>,
          errors: (reply.errors as { path: string; error: string }[] | undefined) ?? [],
        };
        const text =
          JSON.stringify(output.data, null, 2) + (output.errors.length ? "\n\nErrors:\n" + output.errors.map((e) => `${e.path}: ${e.error}`).join("\n") : "");
        return result(text, output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_usage",
    {
      title: "Storage and quota",
      description:
        "Keys and bytes used against the database's limits, and the daily command budget.\n\nReturns: { persistedKeys, persistedBytes, cachedKeys, maxKeys, maxBytes, opsPerDay }",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const reply = await run("INFO");
        if (!reply.ok) return serverError(reply);
        const p = (reply.project ?? {}) as Record<string, number>;
        const output = {
          persistedKeys: p.persistedKeys ?? 0,
          persistedBytes: p.persistedBytes ?? 0,
          cachedKeys: p.cachedKeys ?? 0,
          maxKeys: database.maxKeys,
          maxBytes: database.maxBytes,
          opsPerDay: database.opsPerDay,
        };
        return result(JSON.stringify(output, null, 2), output);
      } catch (err) {
        return fromError(err);
      }
    },
  );

  if (readOnly) {
    return server;
  }

  server.registerTool(
    "denis_execute",
    {
      title: "Run a modifying SQL statement",
      description: `Run INSERT, UPDATE, DELETE, CREATE TABLE or DROP TABLE. Tables are persisted.

  CREATE TABLE [IF NOT EXISTS] t (col TYPE, ...)
  INSERT INTO t (cols) VALUES (vals) [, (vals) ...]
  UPDATE t SET col = v [, ...] [WHERE ...]
  DELETE FROM t [WHERE ...]
  DROP TABLE [IF EXISTS] t

Returns: { type: "affected", affected: number, message: string }`,
      inputSchema: { sql: z.string().min(1).max(50_000) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ sql }) => {
      if (READ_ONLY_SQL.test(sql)) return failure("denis_execute is for statements that modify data", "Use denis_query for SELECT / SHOW TABLES / DESCRIBE.");
      try {
        const reply = await run(sql.replace(/\s*[\r\n]+\s*/g, " "));
        if (!reply.ok) return serverError(reply);
        return result(`OK: ${String(reply.message ?? "")}`, { type: "affected", affected: reply.affected ?? 0, message: reply.message ?? "" });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  server.registerTool(
    "denis_set",
    {
      title: "Set a key",
      description: "Write one key-value entry (objects are stored as JSON). Persisted by default.\n\nReturns: { key, persisted }",
      inputSchema: {
        key: KEY,
        value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
        persist: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ key, value, persist }) => {
      const textValue = typeof value === "string" ? value : JSON.stringify(value);
      if (/[\r\n]/.test(textValue) || /(^|\s)-&/.test(textValue)) return failure("value must not contain line breaks or a word starting with -&");
      try {
        const reply = await run(`SET ${key} ${textValue}${persist ? " -&cache -&save" : ""}`);
        if (!reply.ok) return serverError(reply);
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
      description: "Remove one key from the cache and the persisted store. Returns: { key, deleted }",
      inputSchema: { key: KEY },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ key }) => {
      try {
        const reply = await run(`DEL ${key}`);
        if (!reply.ok) return serverError(reply);
        return result(`Deleted "${key}".`, { key, deleted: true });
      } catch (err) {
        return fromError(err);
      }
    },
  );

  return server;
}

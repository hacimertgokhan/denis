import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as denis from "@/lib/denis/client";
import { GatewayError } from "@/lib/denis/client";
import { type DatabaseRow, audit } from "@/lib/databases";

/**
 * A database as one zip:
 *
 *   manifest.json           { format: 1, database, exportedAt, keys, tables: [{ name, rows }] }
 *   keys.json               { "<key>": "<value>", ... }            every key, values verbatim
 *   tables/<name>.json      { columns: [{ name, type }], rows: [...] }
 *
 * Export reads through the engine with the database's own token, so quotas
 * and isolation apply as usual. Restore replays the archive as SET and
 * INSERT statements; "replace" empties the database first.
 */
export const FORMAT = 1;
const MGET_BATCH = 100;
const PAGE = 1000;
const INSERT_BATCH = 50;
const MAX_ARCHIVE = 64 * 1024 * 1024;
// a zip bomb is a small archive with a huge declared size: refuse before inflating
const MAX_ENTRY = 32 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_KEY = 512;
const MAX_VALUE = 60 * 1024;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TYPES = new Set(["INT", "INTEGER", "REAL", "FLOAT", "DOUBLE", "TEXT", "STRING", "BOOL", "BOOLEAN"]);

type TableInfo = { name: string; columns: { name: string; type: string }[]; rows: number };
type Row = Record<string, unknown>;

const limitsOf = (d: DatabaseRow) => ({ maxKeys: d.maxKeys, maxBytes: d.maxBytes });

async function run(database: DatabaseRow, line: string) {
  const reply = await denis.execute(database.denisToken, line, limitsOf(database));
  if (!reply.ok) throw new GatewayError(`Denis: ${reply.error ?? "command failed"}`, 502, String(reply.code ?? "ENGINE"));
  return reply;
}

export async function exportDatabase(database: DatabaseRow, actorId: string | null) {
  const keys = ((await run(database, "KEYS *")).keys as string[]) ?? [];
  const values: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += MGET_BATCH) {
    const batch = keys.slice(i, i + MGET_BATCH);
    const reply = await run(database, `MGET ${batch.join(" ")}`);
    for (const [k, v] of Object.entries(reply.values as Record<string, string | null>)) if (v !== null) values[k] = v;
  }
  const tables = ((await run(database, "SHOW TABLES")).tables as TableInfo[]) ?? [];
  const files: Record<string, Uint8Array> = {};
  const manifestTables: { name: string; rows: number }[] = [];
  for (const t of tables) {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const reply = await run(database, `SELECT * FROM ${t.name} LIMIT ${PAGE} OFFSET ${offset}`);
      const page = (reply.rows as Row[]) ?? [];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    files[`tables/${t.name}.json`] = strToU8(JSON.stringify({ columns: t.columns, rows }, null, 1));
    manifestTables.push({ name: t.name, rows: rows.length });
  }
  files["keys.json"] = strToU8(JSON.stringify(values, null, 1));
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: FORMAT,
        database: { id: database.id, name: database.name },
        exportedAt: new Date().toISOString(),
        keys: Object.keys(values).length,
        tables: manifestTables,
      },
      null,
      2,
    ),
  );
  const zip = zipSync(files, { level: 6 });
  await audit(actorId, database.id, "database.export", `${Object.keys(values).length} keys, ${tables.length} tables, ${zip.length} bytes`);
  return { zip, keys: Object.keys(values).length, tables: tables.length };
}

// ----------------------------------------------------------------- restore

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export type RestoreReport = {
  keys: { restored: number; skipped: string[] };
  tables: { name: string; rows: number; skipped: number; error?: string }[];
};

export async function restoreDatabase(database: DatabaseRow, archive: Uint8Array, mode: "merge" | "replace", actorId: string | null): Promise<RestoreReport> {
  if (archive.length > MAX_ARCHIVE) throw new GatewayError("The archive is larger than 64 MB", 413, "PAYLOAD_TOO_LARGE");
  let files: Record<string, Uint8Array>;
  let total = 0;
  let entries = 0;
  try {
    files = unzipSync(archive, {
      filter: (f) => {
        entries++;
        total += f.originalSize;
        if (entries > MAX_ENTRIES || f.originalSize > MAX_ENTRY || total > MAX_TOTAL)
          throw new GatewayError("The archive is too large to restore", 413, "PAYLOAD_TOO_LARGE");
        // only the files a backup contains; anything else is ignored unread
        return f.name === "manifest.json" || f.name === "keys.json" || /^tables\/[A-Za-z_][A-Za-z0-9_]{0,63}\.json$/.test(f.name);
      },
    });
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    throw new GatewayError("Not a zip archive", 400, "BAD_ARCHIVE");
  }
  if (!files["manifest.json"]) throw new GatewayError("manifest.json is missing; this is not a Denis backup", 400, "BAD_ARCHIVE");
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as { format: number };
  if (manifest.format !== FORMAT) throw new GatewayError(`Unsupported backup format ${manifest.format}`, 400, "BAD_ARCHIVE");

  if (mode === "replace") await denis.admin().flush(database.denisToken);

  const report: RestoreReport = { keys: { restored: 0, skipped: [] }, tables: [] };
  const parsed: unknown = files["keys.json"] ? JSON.parse(strFromU8(files["keys.json"])) : {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new GatewayError("keys.json must be an object", 400, "BAD_ARCHIVE");
  const values = parsed as Record<string, unknown>;
  for (const [key, raw] of Object.entries(values)) {
    // keys are one word on the wire; values are single lines without flag words — anything else cannot be sent safely
    const value = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (!key || key.length > MAX_KEY || /\s/.test(key) || value.length > MAX_VALUE || /[\r\n]/.test(value) || /(^|\s)-&/.test(value)) {
      report.keys.skipped.push(key);
      continue;
    }
    await run(database, `SET ${key} ${value} -&cache -&save`);
    report.keys.restored++;
  }

  for (const [path, data] of Object.entries(files)) {
    const m = /^tables\/([A-Za-z_][A-Za-z0-9_]*)\.json$/.exec(path);
    if (!m) continue;
    const name = m[1];
    const table = JSON.parse(strFromU8(data)) as { columns: { name: string; type: string }[]; rows: Row[] };
    const entry: RestoreReport["tables"][number] = { name, rows: 0, skipped: 0 };
    report.tables.push(entry);
    try {
      // column names and types come from the file: only identifiers and known types reach the engine
      if (!Array.isArray(table.columns) || table.columns.length === 0 || table.columns.length > 64)
        throw new GatewayError("columns must be a list of 1-64 entries", 400, "BAD_ARCHIVE");
      for (const c of table.columns) {
        if (!IDENT.test(String(c.name))) throw new GatewayError(`invalid column name ${JSON.stringify(c.name)}`, 400, "BAD_ARCHIVE");
        if (!TYPES.has(String(c.type).toUpperCase())) throw new GatewayError(`unsupported column type ${JSON.stringify(c.type)}`, 400, "BAD_ARCHIVE");
      }
      if (!Array.isArray(table.rows)) throw new GatewayError("rows must be a list", 400, "BAD_ARCHIVE");
      await run(database, `CREATE TABLE IF NOT EXISTS ${name} (${table.columns.map((c) => `${c.name} ${String(c.type).toUpperCase()}`).join(", ")})`);
      const cols = table.columns.map((c) => c.name);
      for (let i = 0; i < table.rows.length; i += INSERT_BATCH) {
        const batch = table.rows
          .slice(i, i + INSERT_BATCH)
          .filter(
            (r) =>
              r &&
              typeof r === "object" &&
              !cols.some((c) => typeof r[c] === "string" && (/[\r\n]/.test(r[c] as string) || (r[c] as string).length > MAX_VALUE)),
          );
        entry.skipped += Math.min(INSERT_BATCH, table.rows.length - i) - batch.length;
        if (batch.length === 0) continue;
        const tuples = batch.map((r) => `(${cols.map((c) => sqlLiteral(r[c])).join(", ")})`).join(", ");
        const reply = await run(database, `INSERT INTO ${name} (${cols.join(", ")}) VALUES ${tuples}`);
        entry.rows += Number(reply.affected ?? batch.length);
      }
    } catch (err) {
      entry.error = (err as Error).message;
      if ((err as GatewayError).code === "QUOTA") break;
    }
  }
  await audit(actorId, database.id, "database.restore", `${mode}: ${report.keys.restored} keys, ${report.tables.reduce((n, t) => n + t.rows, 0)} rows`);
  return report;
}

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
  try {
    files = unzipSync(archive);
  } catch {
    throw new GatewayError("Not a zip archive", 400, "BAD_ARCHIVE");
  }
  if (!files["manifest.json"]) throw new GatewayError("manifest.json is missing; this is not a Denis backup", 400, "BAD_ARCHIVE");
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as { format: number };
  if (manifest.format !== FORMAT) throw new GatewayError(`Unsupported backup format ${manifest.format}`, 400, "BAD_ARCHIVE");

  if (mode === "replace") await denis.admin().flush(database.denisToken);

  const report: RestoreReport = { keys: { restored: 0, skipped: [] }, tables: [] };
  const values = files["keys.json"] ? (JSON.parse(strFromU8(files["keys.json"])) as Record<string, string>) : {};
  for (const [key, value] of Object.entries(values)) {
    if (/\s/.test(key) || /[\r\n]/.test(value) || /(^|\s)-&/.test(value)) {
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
      await run(database, `CREATE TABLE IF NOT EXISTS ${name} (${table.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`);
      const cols = table.columns.map((c) => c.name);
      for (let i = 0; i < table.rows.length; i += INSERT_BATCH) {
        const batch = table.rows.slice(i, i + INSERT_BATCH).filter((r) => !cols.some((c) => typeof r[c] === "string" && /[\r\n]/.test(r[c] as string)));
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

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/lib/db";
import { plan } from "@/lib/env";
import * as denis from "@/lib/denis/client";
import { GatewayError, classify, type DenisReply } from "@/lib/denis/client";

const { databases, usageSamples, auditLog, commandLog, user } = schema;

export type DatabaseRow = schema.Database;

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/;

export function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function audit(userId: string | null, databaseId: string | null, action: string, detail?: string) {
  await db.insert(auditLog).values({ id: nanoid(), userId, databaseId, action, detail: detail ?? null });
}

// ------------------------------------------------------------------- queries

export async function listDatabases(userId: string) {
  return db.select().from(databases).where(eq(databases.userId, userId)).orderBy(desc(databases.createdAt));
}

/** A database the user owns, or null. Every per-database page and API goes through this check. */
export async function getOwnedDatabase(userId: string, id: string) {
  const rows = await db
    .select()
    .from(databases)
    .where(and(eq(databases.id, id), eq(databases.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function countDatabases(userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(databases)
    .where(eq(databases.userId, userId));
  return row?.n ?? 0;
}

// -------------------------------------------------------------------- create

export async function createDatabase(userId: string, name: string, region = "eu-central") {
  if (!NAME.test(name)) {
    throw new GatewayError("Name may contain letters, digits, spaces, '-' and '_' (1-48 characters)", 400, "INVALID_NAME");
  }
  const limits = plan();
  const [owner] = await db.select({ maxDatabases: user.maxDatabases }).from(user).where(eq(user.id, userId)).limit(1);
  const allowed = owner?.maxDatabases ?? limits.maxDatabases;
  const count = await countDatabases(userId);
  if (count >= allowed) {
    throw new GatewayError(`Your plan allows ${allowed} databases`, 403, "PLAN_LIMIT");
  }
  const slug = slugify(name) || nanoid(8).toLowerCase();
  const existing = await db
    .select({ id: databases.id })
    .from(databases)
    .where(and(eq(databases.userId, userId), eq(databases.slug, slug)))
    .limit(1);
  if (existing.length > 0) {
    throw new GatewayError("You already have a database with that name", 409, "DUPLICATE");
  }

  // The Denis project carries the hard limits; the platform enforces the daily ops budget.
  const created = await denis.admin().create({ maxKeys: limits.dbMaxKeys, maxBytes: limits.dbMaxBytes });
  const id = nanoid(16);
  try {
    const [row] = await db
      .insert(databases)
      .values({
        id,
        userId,
        name: name.trim(),
        slug,
        region,
        denisToken: created.token,
        maxBytes: limits.dbMaxBytes,
        maxKeys: limits.dbMaxKeys,
        opsPerDay: limits.dbOpsPerDay,
      })
      .returning();
    await audit(userId, id, "database.create", name.trim());
    return row;
  } catch (err) {
    // do not leave an orphan project on the Denis server
    await denis
      .admin()
      .drop(created.token)
      .catch(() => {});
    throw err;
  }
}

export async function deleteDatabase(userId: string, id: string) {
  const database = await getOwnedDatabase(userId, id);
  if (!database) {
    throw new GatewayError("Database not found", 404, "NOT_FOUND");
  }
  await denis
    .admin()
    .drop(database.denisToken)
    .catch((err) => {
      // an already-missing project is fine; anything else must not orphan data silently
      if (!/Unknown project/.test(String(err?.message))) throw err;
    });
  await denis.forget(database.denisToken);
  await db.delete(databases).where(eq(databases.id, id));
  await audit(userId, null, "database.delete", database.name);
}

/** Empty a database (ADMIN FLUSH) keeping its id, keys and quota. */
export async function resetDatabase(userId: string, id: string) {
  const database = await getOwnedDatabase(userId, id);
  if (!database) {
    throw new GatewayError("Database not found", 404, "NOT_FOUND");
  }
  await denis.admin().flush(database.denisToken);
  await sampleUsage(database, true);
  await audit(userId, id, "database.reset");
}

export async function renameDatabase(userId: string, id: string, name: string) {
  if (!NAME.test(name)) {
    throw new GatewayError("Invalid name", 400, "INVALID_NAME");
  }
  const database = await getOwnedDatabase(userId, id);
  if (!database) {
    throw new GatewayError("Database not found", 404, "NOT_FOUND");
  }
  await db
    .update(databases)
    .set({ name: name.trim(), slug: slugify(name) || database.slug })
    .where(eq(databases.id, id));
}

// --------------------------------------------------------------------- usage

const SAMPLE_STALE_MS = 2 * 60 * 1000;

/** Refresh the stored usage from the Denis server when it is older than two minutes (or forced). */
export async function sampleUsage(database: DatabaseRow, force = false) {
  const stale = !database.usageSampledAt || Date.now() - database.usageSampledAt.getTime() > SAMPLE_STALE_MS;
  if (!stale && !force) {
    return database;
  }
  const limits = { maxKeys: database.maxKeys, maxBytes: database.maxBytes };
  const info = await denis
    .admin()
    .usage(database.denisToken)
    .catch(async (err) => {
      if (!denis.isMissingProject(err)) throw err;
      await denis.restoreProject(database.denisToken, limits);
      return denis.admin().usage(database.denisToken);
    });
  const u = info.usage;
  const now = new Date();
  const [updated] = await db
    .update(databases)
    .set({
      cachedKeys: u.cachedKeys,
      cachedBytes: u.cachedBytes,
      persistedKeys: u.persistedKeys,
      persistedBytes: u.persistedBytes,
      usageSampledAt: now,
    })
    .where(eq(databases.id, database.id))
    .returning();
  await db
    .insert(usageSamples)
    .values({
      databaseId: database.id,
      hour: hourOf(now),
      persistedBytes: u.persistedBytes,
      persistedKeys: u.persistedKeys,
      cachedKeys: u.cachedKeys,
    })
    .onConflictDoUpdate({
      target: [usageSamples.databaseId, usageSamples.hour],
      set: { persistedBytes: u.persistedBytes, persistedKeys: u.persistedKeys, cachedKeys: u.cachedKeys },
    });
  return updated ?? database;
}

export function hourOf(date: Date) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function dayStart(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Commands run today (UTC) for a database. */
export async function opsToday(databaseId: string) {
  const [row] = await db
    .select({ ops: sql<number>`coalesce(sum(${usageSamples.ops}), 0)::int` })
    .from(usageSamples)
    .where(and(eq(usageSamples.databaseId, databaseId), gte(usageSamples.hour, dayStart())));
  return row?.ops ?? 0;
}

/** Hourly samples of the last `days` days, oldest first (for charts). */
export async function usageHistory(databaseId: string, days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  return db
    .select()
    .from(usageSamples)
    .where(and(eq(usageSamples.databaseId, databaseId), gte(usageSamples.hour, hourOf(since))))
    .orderBy(usageSamples.hour);
}

/** Hourly samples across all of a user's databases (dashboard). */
export async function usageHistoryForUser(userId: string, days = 7) {
  const since = hourOf(new Date(Date.now() - days * 24 * 3600 * 1000));
  return db
    .select({
      hour: usageSamples.hour,
      ops: sql<number>`sum(${usageSamples.ops})::int`,
      reads: sql<number>`sum(${usageSamples.reads})::int`,
      writes: sql<number>`sum(${usageSamples.writes})::int`,
      errors: sql<number>`sum(${usageSamples.errors})::int`,
      persistedBytes: sql<number>`sum(${usageSamples.persistedBytes})::bigint`,
    })
    .from(usageSamples)
    .innerJoin(databases, eq(databases.id, usageSamples.databaseId))
    .where(and(eq(databases.userId, userId), gte(usageSamples.hour, since)))
    .groupBy(usageSamples.hour)
    .orderBy(usageSamples.hour);
}

async function meter(databaseId: string, kind: "read" | "write", ok: boolean, latencyMs: number) {
  await db
    .insert(usageSamples)
    .values({
      databaseId,
      hour: hourOf(new Date()),
      ops: 1,
      reads: kind === "read" ? 1 : 0,
      writes: kind === "write" ? 1 : 0,
      errors: ok ? 0 : 1,
      latencyMs: Math.round(latencyMs),
    })
    .onConflictDoUpdate({
      target: [usageSamples.databaseId, usageSamples.hour],
      set: {
        ops: sql`${usageSamples.ops} + 1`,
        reads: sql`${usageSamples.reads} + ${kind === "read" ? 1 : 0}`,
        writes: sql`${usageSamples.writes} + ${kind === "write" ? 1 : 0}`,
        errors: sql`${usageSamples.errors} + ${ok ? 0 : 1}`,
        latencyMs: sql`${usageSamples.latencyMs} + ${Math.round(latencyMs)}`,
      },
    });
}

// ------------------------------------------------------------------- execute

export type ExecResult = { reply: DenisReply; latencyMs: number; kind: "read" | "write" };

export type CommandActor = { type: "user" | "account" | "apikey"; id: string; label: string };

/**
 * Run one protocol line on a database: classify, enforce the actor's
 * read-only role/scope and the daily ops budget, execute, meter, and record
 * the command in the history.
 */
export async function runCommand(
  database: DatabaseRow,
  line: string,
  options: { readOnly?: boolean; source: "console" | "api" | "mcp"; actor: CommandActor },
): Promise<ExecResult> {
  const { kind, verb } = classify(line);
  if (options.readOnly && kind === "write") {
    throw new GatewayError(`Read-only access; ${verb} is a write`, 403, "READ_ONLY");
  }
  const used = await opsToday(database.id);
  if (used >= database.opsPerDay) {
    await audit(database.userId, database.id, "quota.ops", `${used}/${database.opsPerDay}`);
    throw new GatewayError(`Daily command budget reached (${database.opsPerDay} per day)`, 429, "OPS_QUOTA");
  }
  const started = performance.now();
  const reply = await denis.execute(database.denisToken, line, { maxKeys: database.maxKeys, maxBytes: database.maxBytes });
  const latencyMs = performance.now() - started;
  await Promise.all([
    meter(database.id, kind, reply.ok, latencyMs),
    logCommand(database.id, options.actor, options.source, line, reply.ok, reply.ok ? null : String(reply.code ?? "ERROR"), latencyMs),
  ]);
  if (!reply.ok && reply.code === "QUOTA") {
    await audit(database.userId, database.id, "quota.storage", String(reply.error));
  }
  return { reply, latencyMs, kind };
}

// ------------------------------------------------------------------- history

const HISTORY_KEEP_DAYS = 30;
let lastPrune = 0;
const AUDIT_KEEP_DAYS = 365;

/** Credentials never reach the log; a LIN/AUTH that slipped through is masked, long lines are cut. */
function redact(line: string) {
  const masked = line.replace(/^(LIN|AUTH|ADMIN)s+.*/i, "$1 ***");
  return masked.length > 2000 ? masked.slice(0, 2000) + " …" : masked;
}

async function logCommand(databaseId: string, actor: CommandActor, source: string, command: string, ok: boolean, errorCode: string | null, latencyMs: number) {
  await db.insert(commandLog).values({
    id: nanoid(16),
    databaseId,
    actorType: actor.type,
    actorId: actor.id,
    actorLabel: actor.label,
    source,
    command: redact(command),
    ok,
    errorCode,
    latencyMs: Math.round(latencyMs),
  });
  // Occasional retention sweep instead of a scheduler.
  if (Date.now() - lastPrune > 60 * 60 * 1000) {
    lastPrune = Date.now();
    const cutoff = new Date(Date.now() - HISTORY_KEEP_DAYS * 24 * 3600 * 1000);
    void db
      .delete(commandLog)
      .where(sql`${commandLog.createdAt} < ${cutoff}`)
      .catch(() => {});
    // the audit log is kept for a year (see /privacy)
    const auditCutoff = new Date(Date.now() - AUDIT_KEEP_DAYS * 24 * 3600 * 1000);
    void db
      .delete(auditLog)
      .where(sql`${auditLog.createdAt} < ${auditCutoff}`)
      .catch(() => {});
  }
}

/** Newest commands first; optional text filter and "only failures". */
type HistoryFilter = { q?: string; failedOnly?: boolean };

function historyWhere(databaseId: string, filter: HistoryFilter) {
  const conditions = [eq(commandLog.databaseId, databaseId)];
  if (filter.q) conditions.push(sql`${commandLog.command} ilike ${"%" + filter.q.replace(/[%_]/g, (m) => "\\" + m) + "%"}`);
  if (filter.failedOnly) conditions.push(eq(commandLog.ok, false));
  return and(...conditions);
}

/** One page of the command log, newest first. */
export async function commandHistory(databaseId: string, options: HistoryFilter & { limit?: number; offset?: number } = {}) {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  return db
    .select()
    .from(commandLog)
    .where(historyWhere(databaseId, options))
    .orderBy(desc(commandLog.createdAt))
    .limit(limit)
    .offset(Math.max(0, options.offset ?? 0));
}

export async function commandHistoryCount(databaseId: string, filter: HistoryFilter = {}) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(commandLog)
    .where(historyWhere(databaseId, filter));
  return row?.n ?? 0;
}

/** Counts for the history header: total, failed, distinct actors in the last 24 h. */
export async function historySummary(databaseId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${commandLog.ok} then 0 else 1 end)::int`,
      actors: sql<number>`count(distinct ${commandLog.actorLabel})::int`,
      avgLatency: sql<number>`coalesce(avg(${commandLog.latencyMs}), 0)::float`,
    })
    .from(commandLog)
    .where(and(eq(commandLog.databaseId, databaseId), gte(commandLog.createdAt, since)));
  return row ?? { total: 0, failed: 0, actors: 0, avgLatency: 0 };
}

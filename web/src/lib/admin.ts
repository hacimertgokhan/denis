import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as denis from "@/lib/denis/client";
import { GatewayError } from "@/lib/denis/client";
import { plan } from "@/lib/env";
import { audit } from "@/lib/databases";
import { currentUser, type PlatformUser } from "@/lib/session";

const { user, session, databases, apiKeys, databaseAccounts, databaseMembers, commandLog, auditLog } = schema;

/**
 * System administration. Every function here re-checks the caller: the UI
 * only decides what to show, the server decides what is allowed.
 */
export async function requireAdminApi(): Promise<PlatformUser> {
  const me = await currentUser();
  if (!me) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  if (me.role !== "admin") throw new GatewayError("System administrators only", 403, "FORBIDDEN");
  return me;
}

function adminAudit(admin: PlatformUser, action: string, detail: string, databaseId: string | null = null) {
  return audit(admin.id, databaseId, action, detail);
}

// ---------------------------------------------------------------- overview

export async function adminStats() {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const [[users], [suspended], [dbs], [keys], [accounts], [members], [commands], [failed], [signups]] = await Promise.all([
    db.select({ n: count() }).from(user),
    db
      .select({ n: count() })
      .from(user)
      .where(sql`${user.disabledAt} is not null`),
    db
      .select({
        n: count(),
        bytes: sql<number>`coalesce(sum(${databases.persistedBytes}), 0)::bigint`,
        keys: sql<number>`coalesce(sum(${databases.persistedKeys}), 0)::int`,
      })
      .from(databases),
    db
      .select({ n: count() })
      .from(apiKeys)
      .where(sql`${apiKeys.revokedAt} is null`),
    db.select({ n: count() }).from(databaseAccounts),
    db.select({ n: count() }).from(databaseMembers),
    db.select({ n: count() }).from(commandLog).where(gte(commandLog.createdAt, dayAgo)),
    db
      .select({ n: count() })
      .from(commandLog)
      .where(and(gte(commandLog.createdAt, dayAgo), eq(commandLog.ok, false))),
    db.select({ n: count() }).from(user).where(gte(user.createdAt, dayAgo)),
  ]);
  return {
    users: users.n,
    suspended: suspended.n,
    signups24h: signups.n,
    databases: dbs.n,
    storedBytes: Number(dbs.bytes),
    storedKeys: dbs.keys,
    activeKeys: keys.n,
    accounts: accounts.n,
    members: members.n,
    commands24h: commands.n,
    failed24h: failed.n,
  };
}

export type EngineProject = {
  token: string;
  usage: { cachedKeys: number; cachedBytes: number; persistedKeys: number; persistedBytes: number };
  quota: { maxKeys: number; maxBytes: number };
};

/** Engine-side view: every project the engine knows, with live usage; null when the engine is unreachable. */
export async function engineProjects(): Promise<EngineProject[] | null> {
  try {
    // denis-client resolves list() to the projects array itself
    const reply = (await denis.admin().list()) as unknown as EngineProject[] | { projects?: EngineProject[] };
    return Array.isArray(reply) ? reply : (reply.projects ?? []);
  } catch {
    return null;
  }
}

/** Engine process information (INFO), or null when the engine is unreachable. */
export async function engineInfo() {
  try {
    return await denis.info();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- users

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: Date | null;
  maxDatabases: number | null;
  createdAt: Date;
  databases: number;
  storedBytes: number;
  lastSeenAt: Date | null;
};

export async function adminListUsers({ q = "", limit = 100 }: { q?: string; limit?: number } = {}): Promise<AdminUserRow[]> {
  const where = q ? or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)) : undefined;
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      disabledAt: user.disabledAt,
      maxDatabases: user.maxDatabases,
      createdAt: user.createdAt,
      // Drizzle drops table qualifiers in a single-table select, so the outer
      // column is spelled out; otherwise "user_id" = "id" compares the subquery row to itself.
      databases: sql<number>`(select count(*) from databases d where d.user_id = "user"."id")::int`,
      storedBytes: sql<number>`(select coalesce(sum(d.persisted_bytes), 0) from databases d where d.user_id = "user"."id")::bigint`,
      lastSeenAt: sql<Date | null>`(select max(s.updated_at) from session s where s.user_id = "user"."id")`,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((r) => ({ ...r, storedBytes: Number(r.storedBytes), lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : null }));
}

export async function adminUpdateUser(admin: PlatformUser, userId: string, patch: { role?: string; disabled?: boolean; maxDatabases?: number | null }) {
  const [target] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!target) throw new GatewayError("User not found", 404, "NOT_FOUND");
  const set: Partial<typeof user.$inferInsert> = {};
  if (patch.role !== undefined) {
    if (patch.role !== "user" && patch.role !== "admin") throw new GatewayError("role must be user or admin", 400, "INVALID_ROLE");
    if (target.id === admin.id && patch.role !== "admin") throw new GatewayError("You cannot remove your own administrator role", 400, "SELF");
    set.role = patch.role;
    await adminAudit(admin, "admin.user.role", `${target.email} -> ${patch.role}`);
  }
  if (patch.disabled !== undefined) {
    if (target.id === admin.id && patch.disabled) throw new GatewayError("You cannot suspend yourself", 400, "SELF");
    set.disabledAt = patch.disabled ? new Date() : null;
    if (patch.disabled) await db.delete(session).where(eq(session.userId, target.id));
    await adminAudit(admin, patch.disabled ? "admin.user.suspend" : "admin.user.restore", target.email);
  }
  if (patch.maxDatabases !== undefined) {
    if (patch.maxDatabases !== null && (!Number.isInteger(patch.maxDatabases) || patch.maxDatabases < 0 || patch.maxDatabases > 1000)) {
      throw new GatewayError("maxDatabases must be an integer between 0 and 1000, or null for the plan default", 400, "BAD_REQUEST");
    }
    set.maxDatabases = patch.maxDatabases;
    await adminAudit(admin, "admin.user.limit", `${target.email} -> ${patch.maxDatabases ?? "plan default"} databases`);
  }
  if (Object.keys(set).length === 0) throw new GatewayError("Nothing to update", 400, "BAD_REQUEST");
  await db.update(user).set(set).where(eq(user.id, target.id));
}

// --------------------------------------------------------------- databases

export type AdminDatabaseRow = {
  id: string;
  name: string;
  slug: string;
  region: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  maxBytes: number;
  maxKeys: number;
  opsPerDay: number;
  persistedBytes: number;
  persistedKeys: number;
  usageSampledAt: Date | null;
  createdAt: Date;
  keys: number;
  accounts: number;
  members: number;
  commands24h: number;
};

export async function adminListDatabases({ q = "", limit = 200 }: { q?: string; limit?: number } = {}): Promise<AdminDatabaseRow[]> {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const where = q ? or(ilike(databases.name, `%${q}%`), ilike(user.email, `%${q}%`), eq(databases.id, q)) : undefined;
  const rows = await db
    .select({
      id: databases.id,
      name: databases.name,
      slug: databases.slug,
      region: databases.region,
      ownerId: databases.userId,
      ownerName: user.name,
      ownerEmail: user.email,
      maxBytes: databases.maxBytes,
      maxKeys: databases.maxKeys,
      opsPerDay: databases.opsPerDay,
      persistedBytes: databases.persistedBytes,
      persistedKeys: databases.persistedKeys,
      usageSampledAt: databases.usageSampledAt,
      createdAt: databases.createdAt,
      keys: sql<number>`(select count(*) from api_keys k where k.database_id = databases.id and k.revoked_at is null)::int`,
      accounts: sql<number>`(select count(*) from database_accounts a where a.database_id = databases.id)::int`,
      members: sql<number>`(select count(*) from database_members m where m.database_id = databases.id)::int`,
      commands24h: sql<number>`(select count(*) from command_log c where c.database_id = databases.id and c.created_at >= ${dayAgo.toISOString()}::timestamp)::int`,
    })
    .from(databases)
    .innerJoin(user, eq(user.id, databases.userId))
    .where(where)
    .orderBy(desc(databases.createdAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
  return rows;
}

/** Change a database's limits; the engine is told about key/byte quotas so it enforces them itself. */
export async function adminUpdateDatabase(admin: PlatformUser, id: string, patch: { maxBytes?: number; maxKeys?: number; opsPerDay?: number }) {
  const [row] = await db.select().from(databases).where(eq(databases.id, id)).limit(1);
  if (!row) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  const next = {
    maxBytes: patch.maxBytes ?? row.maxBytes,
    maxKeys: patch.maxKeys ?? row.maxKeys,
    opsPerDay: patch.opsPerDay ?? row.opsPerDay,
  };
  for (const [k, v] of Object.entries(next)) {
    if (!Number.isInteger(v) || v <= 0) throw new GatewayError(`${k} must be a positive integer`, 400, "BAD_REQUEST");
  }
  if (next.maxKeys !== row.maxKeys || next.maxBytes !== row.maxBytes) {
    await denis.admin().quota(row.denisToken, next.maxKeys, next.maxBytes);
  }
  await db.update(databases).set(next).where(eq(databases.id, id));
  await adminAudit(admin, "admin.database.limits", `${row.name}: ${next.maxKeys} keys, ${next.maxBytes} bytes, ${next.opsPerDay} ops/day`, id);
}

export async function adminDeleteDatabase(admin: PlatformUser, id: string) {
  const [row] = await db.select().from(databases).where(eq(databases.id, id)).limit(1);
  if (!row) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  await denis
    .admin()
    .drop(row.denisToken)
    .catch((err) => {
      if (!/Unknown project/.test(String(err?.message))) throw err;
    });
  await denis.forget(row.denisToken);
  await db.delete(databases).where(eq(databases.id, id));
  await adminAudit(admin, "admin.database.delete", `${row.name} (owner ${row.userId})`);
}

// ---------------------------------------------------------------- accounts

export async function adminListAccounts({ q = "", limit = 200 }: { q?: string; limit?: number } = {}) {
  const where = q ? or(ilike(databaseAccounts.username, `%${q}%`), ilike(databases.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined;
  return db
    .select({
      id: databaseAccounts.id,
      username: databaseAccounts.username,
      role: databaseAccounts.role,
      lastLoginAt: databaseAccounts.lastLoginAt,
      disabledAt: databaseAccounts.disabledAt,
      createdAt: databaseAccounts.createdAt,
      databaseId: databases.id,
      databaseName: databases.name,
      ownerEmail: user.email,
    })
    .from(databaseAccounts)
    .innerJoin(databases, eq(databases.id, databaseAccounts.databaseId))
    .innerJoin(user, eq(user.id, databases.userId))
    .where(where)
    .orderBy(desc(databaseAccounts.createdAt))
    .limit(Math.min(Math.max(limit, 1), 1000));
}

export async function adminUpdateAccount(admin: PlatformUser, id: string, patch: { disabled?: boolean }) {
  const [row] = await db.select().from(databaseAccounts).where(eq(databaseAccounts.id, id)).limit(1);
  if (!row) throw new GatewayError("Account not found", 404, "NOT_FOUND");
  if (patch.disabled === undefined) throw new GatewayError("Nothing to update", 400, "BAD_REQUEST");
  await db
    .update(databaseAccounts)
    .set({ disabledAt: patch.disabled ? new Date() : null })
    .where(eq(databaseAccounts.id, id));
  await adminAudit(admin, patch.disabled ? "admin.account.suspend" : "admin.account.restore", row.username, row.databaseId);
}

export async function adminDeleteAccount(admin: PlatformUser, id: string) {
  const [row] = await db.delete(databaseAccounts).where(eq(databaseAccounts.id, id)).returning();
  if (!row) throw new GatewayError("Account not found", 404, "NOT_FOUND");
  await adminAudit(admin, "admin.account.delete", row.username, row.databaseId);
}

// ---------------------------------------------------------------- activity

export async function adminAuditLog({ limit = 100, q = "" }: { limit?: number; q?: string } = {}) {
  const where = q ? or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.detail, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined;
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      userEmail: user.email,
      databaseName: databases.name,
      databaseId: auditLog.databaseId,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .leftJoin(databases, eq(databases.id, auditLog.databaseId))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Recent commands across every database, for spotting abuse. */
export async function adminRecentCommands({ limit = 100, failedOnly = false }: { limit?: number; failedOnly?: boolean } = {}) {
  return db
    .select({
      id: commandLog.id,
      command: commandLog.command,
      ok: commandLog.ok,
      latencyMs: commandLog.latencyMs,
      source: commandLog.source,
      actorType: commandLog.actorType,
      actorLabel: commandLog.actorLabel,
      createdAt: commandLog.createdAt,
      databaseId: commandLog.databaseId,
      databaseName: databases.name,
    })
    .from(commandLog)
    .innerJoin(databases, eq(databases.id, commandLog.databaseId))
    .where(failedOnly ? eq(commandLog.ok, false) : undefined)
    .orderBy(desc(commandLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export function planDefaults() {
  return plan();
}

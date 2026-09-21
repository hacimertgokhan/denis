import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { GatewayError } from "@/lib/denis/client";
import { audit, type DatabaseRow } from "@/lib/databases";

const { databases, databaseMembers, databaseAccounts, user } = schema;

export type Role = schema.Role;
export const ROLES = schema.ROLES;

/**
 * Who is acting on a database and with which role. Platform users are
 * owners or members; database-local accounts sign in at /db/<id>/login;
 * API keys map to editor (write) or viewer (read).
 */
export type Actor =
  | { type: "user"; id: string; label: string; role: Role }
  | { type: "account"; id: string; label: string; role: Role }
  | { type: "apikey"; id: string; label: string; role: Role };

export type Access = { database: DatabaseRow; actor: Actor };

// ---------------------------------------------------------------- permissions

export type Action = "read" | "write" | "manage_keys" | "manage_access" | "manage_database" | "view_history";

const GRANTS: Record<Role, Action[]> = {
  owner: ["read", "write", "manage_keys", "manage_access", "manage_database", "view_history"],
  admin: ["read", "write", "manage_keys", "manage_access", "view_history"],
  editor: ["read", "write", "view_history"],
  viewer: ["read", "view_history"],
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including deleting the database.",
  admin: "Read, write, manage API keys, members and database accounts.",
  editor: "Read and write data; cannot manage access or keys.",
  viewer: "Read data and the command history only.",
};

export function can(role: Role, action: Action) {
  return GRANTS[role].includes(action);
}

export function require(actor: Actor, action: Action) {
  if (!can(actor.role, action)) {
    throw new GatewayError(`Your role (${actor.role}) cannot do that`, 403, "FORBIDDEN");
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ platform

/** A database a platform user may open (owner or member), with their role. */
export async function getAccess(userId: string, databaseId: string): Promise<Access | null> {
  const rows = await db.select().from(databases).where(eq(databases.id, databaseId)).limit(1);
  const database = rows[0];
  if (!database) return null;
  const [me] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  const label = me?.name || me?.email || "user";
  if (database.userId === userId) {
    return { database, actor: { type: "user", id: userId, label, role: "owner" } };
  }
  const [member] = await db
    .select()
    .from(databaseMembers)
    .where(and(eq(databaseMembers.databaseId, databaseId), eq(databaseMembers.userId, userId)))
    .limit(1);
  if (!member || !isRole(member.role)) return null;
  return { database, actor: { type: "user", id: userId, label, role: member.role } };
}

/** Databases shared with a user (not owned), with the role. */
export async function listSharedDatabases(userId: string) {
  return db
    .select({ database: databases, role: databaseMembers.role })
    .from(databaseMembers)
    .innerJoin(databases, eq(databases.id, databaseMembers.databaseId))
    .where(eq(databaseMembers.userId, userId))
    .orderBy(desc(databaseMembers.createdAt));
}

export async function listMembers(databaseId: string) {
  return db
    .select({
      id: databaseMembers.id,
      userId: databaseMembers.userId,
      role: databaseMembers.role,
      createdAt: databaseMembers.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(databaseMembers)
    .innerJoin(user, eq(user.id, databaseMembers.userId))
    .where(eq(databaseMembers.databaseId, databaseId))
    .orderBy(databaseMembers.createdAt);
}

/** Add (or re-role) a platform user by email. */
export async function addMember(access: Access, email: string, role: Role) {
  require(access.actor, "manage_access");
  if (role === "owner") throw new GatewayError("Ownership cannot be granted", 400, "INVALID_ROLE");
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.trim().toLowerCase())).limit(1);
  if (!target) throw new GatewayError("No account with that email. They need to sign up first.", 404, "USER_NOT_FOUND");
  if (target.id === access.database.userId) throw new GatewayError("That user owns this database", 400, "ALREADY_OWNER");
  await db
    .insert(databaseMembers)
    .values({ id: nanoid(12), databaseId: access.database.id, userId: target.id, role, invitedBy: access.actor.type === "user" ? access.actor.id : null })
    .onConflictDoUpdate({ target: [databaseMembers.databaseId, databaseMembers.userId], set: { role } });
  await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "member.add", `${email} (${role})`);
}

export async function updateMemberRole(access: Access, memberId: string, role: Role) {
  require(access.actor, "manage_access");
  if (role === "owner") throw new GatewayError("Ownership cannot be granted", 400, "INVALID_ROLE");
  const [row] = await db
    .update(databaseMembers)
    .set({ role })
    .where(and(eq(databaseMembers.id, memberId), eq(databaseMembers.databaseId, access.database.id)))
    .returning();
  if (row) await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "member.update", `${row.userId} -> ${role}`);
  return Boolean(row);
}

export async function removeMember(access: Access, memberId: string) {
  require(access.actor, "manage_access");
  const [row] = await db
    .delete(databaseMembers)
    .where(and(eq(databaseMembers.id, memberId), eq(databaseMembers.databaseId, access.database.id)))
    .returning();
  if (row) await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "member.remove", row.userId);
  return Boolean(row);
}

// ----------------------------------------------------------- local accounts

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function listAccounts(databaseId: string) {
  return db
    .select({
      id: databaseAccounts.id,
      username: databaseAccounts.username,
      role: databaseAccounts.role,
      lastLoginAt: databaseAccounts.lastLoginAt,
      disabledAt: databaseAccounts.disabledAt,
      createdAt: databaseAccounts.createdAt,
    })
    .from(databaseAccounts)
    .where(eq(databaseAccounts.databaseId, databaseId))
    .orderBy(databaseAccounts.createdAt);
}

export async function createAccount(access: Access, username: string, password: string, role: Role) {
  require(access.actor, "manage_access");
  const name = username.trim().toLowerCase();
  if (!USERNAME.test(name)) throw new GatewayError("Usernames are 3-32 characters: letters, digits, '.', '_' or '-'", 400, "INVALID_USERNAME");
  if (password.length < 8) throw new GatewayError("Passwords need at least 8 characters", 400, "WEAK_PASSWORD");
  if (role === "owner") throw new GatewayError("Ownership cannot be granted", 400, "INVALID_ROLE");
  const existing = await db
    .select({ id: databaseAccounts.id })
    .from(databaseAccounts)
    .where(and(eq(databaseAccounts.databaseId, access.database.id), eq(databaseAccounts.username, name)))
    .limit(1);
  if (existing.length) throw new GatewayError("That username is taken in this database", 409, "DUPLICATE");
  const [row] = await db
    .insert(databaseAccounts)
    .values({ id: nanoid(12), databaseId: access.database.id, username: name, passwordHash: hashPassword(password), role })
    .returning();
  await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "account.create", `${name} (${role})`);
  return row;
}

export async function updateAccount(access: Access, accountId: string, patch: { role?: Role; password?: string; disabled?: boolean }) {
  require(access.actor, "manage_access");
  const set: Partial<typeof databaseAccounts.$inferInsert> = {};
  if (patch.role) {
    if (patch.role === "owner") throw new GatewayError("Ownership cannot be granted", 400, "INVALID_ROLE");
    set.role = patch.role;
  }
  if (patch.password !== undefined) {
    if (patch.password.length < 8) throw new GatewayError("Passwords need at least 8 characters", 400, "WEAK_PASSWORD");
    set.passwordHash = hashPassword(patch.password);
  }
  if (patch.disabled !== undefined) set.disabledAt = patch.disabled ? new Date() : null;
  const [row] = await db
    .update(databaseAccounts)
    .set(set)
    .where(and(eq(databaseAccounts.id, accountId), eq(databaseAccounts.databaseId, access.database.id)))
    .returning();
  if (!row) throw new GatewayError("Account not found", 404, "NOT_FOUND");
  await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "account.update", row.username);
  return row;
}

export async function deleteAccount(access: Access, accountId: string) {
  require(access.actor, "manage_access");
  const [row] = await db
    .delete(databaseAccounts)
    .where(and(eq(databaseAccounts.id, accountId), eq(databaseAccounts.databaseId, access.database.id)))
    .returning();
  if (row) await audit(access.actor.type === "user" ? access.actor.id : null, access.database.id, "account.delete", row.username);
  return Boolean(row);
}

// ------------------------------------------------------- local sessions (JWT)

const enc = new TextEncoder();
const SESSION_TTL = 12 * 3600;

export function dbCookieName(databaseId: string) {
  return `denis_db_${databaseId}`;
}

/** Sign in a database-local account; returns the JWT to set as a cookie. */
export async function signInAccount(databaseId: string, username: string, password: string) {
  const [row] = await db
    .select()
    .from(databaseAccounts)
    .where(and(eq(databaseAccounts.databaseId, databaseId), eq(databaseAccounts.username, username.trim().toLowerCase()), isNull(databaseAccounts.disabledAt)))
    .limit(1);
  // same timing whether the user exists or not
  const ok = row ? verifyPassword(password, row.passwordHash) : (verifyPassword(password, hashPassword("x")), false);
  if (!row || !ok) throw new GatewayError("Wrong username or password", 401, "UNAUTHORIZED");
  await db.update(databaseAccounts).set({ lastLoginAt: new Date() }).where(eq(databaseAccounts.id, row.id));
  const e = env();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ type: "db-session", db: databaseId, account: row.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(e.NEXT_PUBLIC_APP_URL)
    .setSubject(row.id)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL)
    .sign(enc.encode(e.JWT_SECRET));
  return { token, maxAge: SESSION_TTL, account: row };
}

/** The database-local account behind a cookie value, or null. */
export async function verifyAccountSession(databaseId: string, token: string | undefined): Promise<Access | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(env().JWT_SECRET), { issuer: env().NEXT_PUBLIC_APP_URL });
    if (payload.type !== "db-session" || payload.db !== databaseId || typeof payload.account !== "string") return null;
    const rows = await db
      .select({ account: databaseAccounts, database: databases })
      .from(databaseAccounts)
      .innerJoin(databases, eq(databases.id, databaseAccounts.databaseId))
      .where(and(eq(databaseAccounts.id, payload.account), eq(databaseAccounts.databaseId, databaseId), isNull(databaseAccounts.disabledAt)))
      .limit(1);
    const hit = rows[0];
    if (!hit || !isRole(hit.account.role)) return null;
    return { database: hit.database, actor: { type: "account", id: hit.account.id, label: hit.account.username, role: hit.account.role } };
  } catch {
    return null;
  }
}

/** Server components: the database-local session from the request cookies. */
export async function currentAccountAccess(databaseId: string) {
  const jar = await cookies();
  return verifyAccountSession(databaseId, jar.get(dbCookieName(databaseId))?.value);
}

// ------------------------------------------------------------ request access

/**
 * Who is calling a per-database route: the platform session first, then the
 * database-local cookie. Throws 401 when nobody is signed in and 404 when the
 * caller may not see this database (no distinction, on purpose).
 */
export async function requestAccess(databaseId: string, action: Action): Promise<Access> {
  const user = await currentUser();
  let access: Access | null = null;
  if (user) {
    access = await getAccess(user.id, databaseId);
  }
  if (!access) {
    access = await currentAccountAccess(databaseId);
  }
  if (!access) {
    if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
    throw new GatewayError("Database not found", 404, "NOT_FOUND");
  }
  require(access.actor, action);
  return access;
}

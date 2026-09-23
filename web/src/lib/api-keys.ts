import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { GatewayError } from "@/lib/denis/client";
import { audit, type DatabaseRow } from "@/lib/databases";

const { apiKeys, databases } = schema;

export type ApiKeyRow = schema.ApiKey;
export type Scope = "read" | "write";

/**
 * API keys: `dk_` + 40 url-safe characters, shown once, stored as SHA-256.
 * A key belongs to one database and has a scope; it authenticates the REST
 * API and the MCP endpoint, and can be exchanged for short-lived JWTs.
 */

export function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export async function createApiKey(userId: string, database: DatabaseRow, name: string, scope: Scope) {
  if (!name.trim() || name.length > 48) {
    throw new GatewayError("Key name must be 1-48 characters", 400, "INVALID_NAME");
  }
  const secret = "dk_" + randomBytes(30).toString("base64url").slice(0, 40);
  const [row] = await db
    .insert(apiKeys)
    .values({
      id: nanoid(12),
      databaseId: database.id,
      userId,
      name: name.trim(),
      prefix: secret.slice(0, 12),
      keyHash: hashKey(secret),
      scope,
    })
    .returning();
  await audit(userId, database.id, "apikey.create", `${name.trim()} (${scope})`);
  return { row, secret };
}

export async function listApiKeys(databaseId: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.databaseId, databaseId)).orderBy(apiKeys.createdAt);
}

export async function revokeApiKey(userId: string, keyId: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning();
  if (row) {
    await audit(userId, row.databaseId, "apikey.revoke", row.name);
  }
  return row ?? null;
}

/** Revoke any key of a database (owners and admins); auditedBy is the platform user credited. */
export async function revokeApiKeyInDatabase(databaseId: string, keyId: string, auditedBy: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.databaseId, databaseId), isNull(apiKeys.revokedAt)))
    .returning();
  if (row) {
    await audit(auditedBy, row.databaseId, "apikey.revoke", row.name);
  }
  return row ?? null;
}

export type Principal = { database: DatabaseRow; scope: Scope; keyId: string; keyName: string; via: "api-key" | "jwt" };

/** Resolve a raw API key to its database, or null. Updates last-used lazily. */
export async function authenticateApiKey(secret: string): Promise<Principal | null> {
  if (!secret.startsWith("dk_")) return null;
  const rows = await db
    .select({ key: apiKeys, database: databases })
    .from(apiKeys)
    .innerJoin(databases, eq(databases.id, apiKeys.databaseId))
    .where(and(eq(apiKeys.keyHash, hashKey(secret)), isNull(apiKeys.revokedAt)))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  const lastUsed = hit.key.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > 60_000) {
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, hit.key.id));
  }
  return { database: hit.database, scope: hit.key.scope as Scope, keyId: hit.key.id, keyName: hit.key.name, via: "api-key" };
}

// ----------------------------------------------------------------------- JWT

const enc = new TextEncoder();

/** Access + refresh token pair for an API key (JWT_SECRET / JWT_REFRESH_SECRET). */
export async function issueTokens(principal: Principal) {
  const e = env();
  const now = Math.floor(Date.now() / 1000);
  const claims = { db: principal.database.id, key: principal.keyId, scope: principal.scope };
  const accessToken = await new SignJWT({ ...claims, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(e.NEXT_PUBLIC_APP_URL)
    .setSubject(principal.database.id)
    .setIssuedAt(now)
    .setExpirationTime(now + e.JWT_ACCESS_TTL)
    .sign(enc.encode(e.JWT_SECRET));
  const refreshToken = await new SignJWT({ ...claims, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(e.NEXT_PUBLIC_APP_URL)
    .setSubject(principal.database.id)
    .setIssuedAt(now)
    .setExpirationTime(now + e.JWT_REFRESH_TTL)
    .sign(enc.encode(e.JWT_REFRESH_SECRET));
  return { accessToken, refreshToken, expiresIn: e.JWT_ACCESS_TTL, tokenType: "Bearer" as const };
}

async function verify(token: string, type: "access" | "refresh"): Promise<Principal | null> {
  const e = env();
  try {
    const { payload } = await jwtVerify(token, enc.encode(type === "access" ? e.JWT_SECRET : e.JWT_REFRESH_SECRET), {
      issuer: e.NEXT_PUBLIC_APP_URL,
    });
    if (payload.type !== type || typeof payload.key !== "string" || typeof payload.db !== "string") return null;
    // the key must still exist and be unrevoked, so revocation takes effect immediately
    const rows = await db
      .select({ key: apiKeys, database: databases })
      .from(apiKeys)
      .innerJoin(databases, eq(databases.id, apiKeys.databaseId))
      .where(and(eq(apiKeys.id, payload.key), eq(apiKeys.databaseId, payload.db), isNull(apiKeys.revokedAt)))
      .limit(1);
    const hit = rows[0];
    if (!hit) return null;
    return { database: hit.database, scope: hit.key.scope as Scope, keyId: hit.key.id, keyName: hit.key.name, via: "jwt" };
  } catch {
    return null;
  }
}

export const verifyAccessToken = (token: string) => verify(token, "access");
export const verifyRefreshToken = (token: string) => verify(token, "refresh");

/** Bearer credential of a request: an API key or an access JWT. */
export async function authenticateRequest(request: Request): Promise<Principal> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const credential = match?.[1]?.trim() ?? new URL(request.url).searchParams.get("api_key") ?? "";
  if (!credential) {
    throw new GatewayError("Missing Authorization: Bearer <api key or access token>", 401, "UNAUTHORIZED");
  }
  const principal = credential.startsWith("dk_") ? await authenticateApiKey(credential) : await verifyAccessToken(credential);
  if (!principal) {
    throw new GatewayError("Invalid or revoked credential", 401, "UNAUTHORIZED");
  }
  return principal;
}

// ---------------------------------------------------------------- rate limit

const buckets = new Map<string, { count: number; windowStart: number }>();

/** Fixed one-minute window per API key (in-process; good enough for one instance). */
export function checkRateLimit(keyId: string) {
  const limit = env().PLAN_API_RATE_PER_MINUTE;
  const now = Date.now();
  const bucket = buckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    buckets.set(keyId, { count: 1, windowStart: now });
    return;
  }
  bucket.count++;
  if (bucket.count > limit) {
    throw new GatewayError(`Rate limit: ${limit} requests per minute`, 429, "RATE_LIMIT");
  }
}

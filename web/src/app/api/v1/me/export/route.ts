import { desc, eq, inArray } from "drizzle-orm";
import { handler } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { GatewayError } from "@/lib/denis/client";
import { listSharedDatabases } from "@/lib/access";
import { listDatabases } from "@/lib/databases";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

/**
 * Data portability (GDPR art. 20, KVKK art. 11): everything the platform
 * stores about the signed-in user, as one JSON download. Database contents
 * are not included — they belong to the user's databases and are exported
 * from the console or the API (KEYS / MGET, SELECT).
 */
export const GET = handler(async () => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  rateLimit(`account:${user.id}`, LIMITS.account.max, LIMITS.account.windowMs, "exports");
  const databases = await listDatabases(user.id);
  const ids = databases.map((d) => d.id);
  const [shared, keys, members, accounts, audit, commands, sessions] = await Promise.all([
    listSharedDatabases(user.id),
    ids.length ? db.select().from(schema.apiKeys).where(inArray(schema.apiKeys.databaseId, ids)) : [],
    ids.length ? db.select().from(schema.databaseMembers).where(inArray(schema.databaseMembers.databaseId, ids)) : [],
    ids.length ? db.select().from(schema.databaseAccounts).where(inArray(schema.databaseAccounts.databaseId, ids)) : [],
    db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, user.id)).orderBy(desc(schema.auditLog.createdAt)).limit(5000),
    ids.length
      ? db.select().from(schema.commandLog).where(inArray(schema.commandLog.databaseId, ids)).orderBy(desc(schema.commandLog.createdAt)).limit(20000)
      : [],
    db
      .select({
        id: schema.session.id,
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, user.id)),
  ]);
  const body = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt, maxDatabases: user.maxDatabases },
    sessions,
    databases: databases.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      region: d.region,
      limits: { maxBytes: d.maxBytes, maxKeys: d.maxKeys, opsPerDay: d.opsPerDay },
      usage: { persistedKeys: d.persistedKeys, persistedBytes: d.persistedBytes, sampledAt: d.usageSampledAt },
      createdAt: d.createdAt,
      // the Denis project token itself is a platform secret and is not exported
    })),
    sharedWithMe: shared.map((s) => ({ id: s.database.id, name: s.database.name, role: s.role })),
    // secrets are stored hashed; only metadata exists to export
    apiKeys: keys.map((k) => ({ ...k, keyHash: undefined })),
    members,
    databaseAccounts: accounts.map((a) => ({ ...a, passwordHash: undefined })),
    auditLog: audit,
    commandLog: commands,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="denis-cloud-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

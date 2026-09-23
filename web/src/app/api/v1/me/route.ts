import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { handler, ok, readJson } from "@/lib/api";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { GatewayError } from "@/lib/denis/client";
import { plan } from "@/lib/env";
import { audit, countDatabases, deleteDatabase, listDatabases } from "@/lib/databases";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = handler(async () => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const used = await countDatabases(user.id);
  return ok({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified, marketingOptIn: user.marketingOptIn },
    plan: { ...plan(), maxDatabases: user.maxDatabases, databasesUsed: used },
  });
});

/** Preferences a user sets for themselves. Body: { marketingOptIn?: boolean } */
export const PATCH = handler(async (request: Request) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const body = await readJson<{ marketingOptIn?: boolean }>(request);
  if (typeof body.marketingOptIn !== "boolean") throw new GatewayError("Nothing to update", 400, "BAD_REQUEST");
  await db.update(schema.user).set({ marketingOptIn: body.marketingOptIn }).where(eq(schema.user.id, user.id));
  return ok({ marketingOptIn: body.marketingOptIn });
});

/**
 * Right to erasure (GDPR art. 17): deletes the account, every
 * database it owns (the engine projects are dropped first), its API keys,
 * memberships, database accounts and sessions. The body must repeat the
 * account email as confirmation. Audit rows keep a null user reference.
 */
export const DELETE = handler(async (request: Request) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  rateLimit(`account:${user.id}`, LIMITS.account.max, LIMITS.account.windowMs, "attempts");
  const body = await readJson<{ confirm?: string }>(request);
  if (
    String(body.confirm ?? "")
      .trim()
      .toLowerCase() !== user.email.toLowerCase()
  ) {
    throw new GatewayError("Type your email address to confirm", 400, "CONFIRM");
  }
  for (const d of await listDatabases(user.id)) await deleteDatabase(user.id, d.id);
  await audit(null, null, "user.delete", user.email);
  await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
  await db.delete(schema.user).where(eq(schema.user.id, user.id));
  return ok({ deleted: true });
});

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { env, plan } from "@/lib/env";

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "user" | "admin";
  emailVerified: boolean;
  marketingOptIn: boolean;
  twoFactorEnabled: boolean;
  disabledAt: Date | null;
  /** Effective database allowance: the admin override or the plan default. */
  maxDatabases: number;
  createdAt: Date;
};

function bootstrapAdmins() {
  return new Set(
    env()
      .PLATFORM_ADMINS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Whether an email is a system administrator by configuration (PLATFORM_ADMINS). */
export function isBootstrapAdmin(email: string) {
  return bootstrapAdmins().has(email.toLowerCase());
}

/**
 * Resolves the session to the current user row. Role and suspension are read
 * from the database on every request (the session cookie cache is not trusted
 * for authorization), and configured bootstrap admins are promoted on sight.
 */
async function loadUser(): Promise<{ user: PlatformUser; suspended: boolean } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).limit(1);
  if (!row) return null;
  let role = row.role === "admin" ? "admin" : "user";
  if (role !== "admin" && isBootstrapAdmin(row.email)) {
    await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, row.id));
    role = "admin";
  }
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      role: role as "user" | "admin",
      emailVerified: row.emailVerified,
      marketingOptIn: row.marketingOptIn,
      twoFactorEnabled: row.twoFactorEnabled,
      disabledAt: row.disabledAt,
      maxDatabases: row.maxDatabases ?? plan().maxDatabases,
      createdAt: row.createdAt,
    },
    suspended: row.disabledAt !== null,
  };
}

/** The signed-in user for a server component, or a redirect to /login. Suspended accounts are signed out. */
export async function requireUser(): Promise<PlatformUser> {
  const loaded = await loadUser();
  if (!loaded) redirect("/login");
  if (loaded.suspended) {
    await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
    redirect("/login?suspended=1");
  }
  return loaded.user;
}

/** The signed-in, non-suspended user or null (for route handlers that answer 401 themselves). */
export async function currentUser(): Promise<PlatformUser | null> {
  const loaded = await loadUser();
  if (!loaded || loaded.suspended) return null;
  return loaded.user;
}

/** A system administrator, or a redirect / 404 for everyone else. */
export async function requireAdmin(): Promise<PlatformUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

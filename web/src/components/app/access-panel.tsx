import { eq } from "drizzle-orm";
import { AccessManager } from "@/components/app/access-manager";
import { type Access, can, listAccounts, listMembers } from "@/lib/access";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

/** Loads members, accounts and the owner for the Access tab; the caller has already checked access. */
export async function AccessPanel({ access }: { access: Access }) {
  const id = access.database.id;
  const [members, accounts, [owner]] = await Promise.all([
    listMembers(id),
    listAccounts(id),
    db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, access.database.userId)).limit(1),
  ]);
  return (
    <AccessManager
      databaseId={id}
      owner={owner ?? { name: "Owner", email: "" }}
      members={members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
      accounts={accounts.map((a) => ({
        ...a,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        disabledAt: a.disabledAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      }))}
      loginUrl={`${env().NEXT_PUBLIC_APP_URL}/db/${id}/login`}
      canManage={can(access.actor.role, "manage_access")}
    />
  );
}

import { AdminUsers } from "@/components/app/admin-users";
import { PageHeader } from "@/components/app/page-primitives";
import { adminListUsers } from "@/lib/admin";
import { plan } from "@/lib/env";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: "Users" };

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const users = await adminListUsers();
  return (
    <>
      <PageHeader title="Users" description="Platform accounts. Suspending one signs it out everywhere and blocks sign-in; its databases stay." />
      <AdminUsers
        meId={me.id}
        planMax={plan().maxDatabases}
        users={users.map((u) => ({
          ...u,
          disabledAt: u.disabledAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}

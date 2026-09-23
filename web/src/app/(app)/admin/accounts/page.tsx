import { AdminAccounts } from "@/components/app/admin-accounts";
import { PageHeader } from "@/components/app/page-primitives";
import { adminListAccounts } from "@/lib/admin";

export const metadata = { title: "Database accounts" };

export default async function AdminAccountsPage() {
  const accounts = await adminListAccounts();
  return (
    <>
      <PageHeader
        title="Database accounts"
        description="Usernames that sign in at a database's own login page. Owners manage them; you can suspend or remove any of them."
      />
      <AdminAccounts
        accounts={accounts.map((a) => ({
          ...a,
          lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
          disabledAt: a.disabledAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </>
  );
}

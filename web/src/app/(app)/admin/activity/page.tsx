import { AdminActivity } from "@/components/app/admin-activity";
import { PageHeader } from "@/components/app/page-primitives";
import { adminAuditLog, adminRecentCommands } from "@/lib/admin";

export const metadata = { title: "Activity" };

export default async function AdminActivityPage() {
  const [audit, commands] = await Promise.all([adminAuditLog({ limit: 200 }), adminRecentCommands({ limit: 200 })]);
  return (
    <>
      <PageHeader title="Activity" description="Administrative actions across the platform and the latest commands sent to any database." />
      <AdminActivity
        audit={audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
        commands={commands.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      />
    </>
  );
}

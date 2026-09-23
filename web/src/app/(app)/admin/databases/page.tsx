import { AdminDatabases } from "@/components/app/admin-databases";
import { PageHeader } from "@/components/app/page-primitives";
import { adminListDatabases } from "@/lib/admin";

export const metadata = { title: "Databases" };

export default async function AdminDatabasesPage() {
  const databases = await adminListDatabases();
  return (
    <>
      <PageHeader
        title="Databases"
        description="Every database on the platform with its owner, limits and live usage. Limits changed here are pushed to the engine."
      />
      <AdminDatabases
        databases={databases.map((d) => ({
          ...d,
          usageSampledAt: d.usageSampledAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </>
  );
}

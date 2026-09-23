import { notFound, redirect } from "next/navigation";
import { DatabaseSettings } from "@/components/app/database-settings";
import { can, currentAccountAccess } from "@/lib/access";

export const metadata = { title: "Settings" };

export default async function WorkspaceSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  if (!can(access.actor.role, "manage_database")) notFound();
  const database = access.database;
  return (
    <DatabaseSettings
      database={{ id: database.id, name: database.name, region: database.region, createdAt: database.createdAt.toISOString() }}
      isOwner={false}
    />
  );
}

import { notFound } from "next/navigation";
import { DatabaseSettings } from "@/components/app/database-settings";
import { can, getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access || !can(access.actor.role, "manage_database")) notFound();
  const database = access.database;
  return (
    <DatabaseSettings
      database={{ id: database.id, name: database.name, region: database.region, createdAt: database.createdAt.toISOString() }}
      isOwner={access.actor.role === "owner"}
    />
  );
}

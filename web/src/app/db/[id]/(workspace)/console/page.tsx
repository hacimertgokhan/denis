import { redirect } from "next/navigation";
import { currentAccountAccess } from "@/lib/access";
import { Console } from "@/components/app/console";

export const metadata = { title: "Console" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  return <Console databaseId={id} databaseName={access.database.name} readOnly={access.actor.role === "viewer"} />;
}

import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { Console } from "@/components/app/console";

export const metadata = { title: "Console" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  return <Console databaseId={access.database.id} databaseName={access.database.name} readOnly={access.actor.role === "viewer"} />;
}

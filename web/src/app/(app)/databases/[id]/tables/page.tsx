import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { TablesBrowser } from "@/components/app/tables-browser";

export const metadata = { title: "Tables" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  return <TablesBrowser databaseId={access.database.id} readOnly={access.actor.role === "viewer"} />;
}

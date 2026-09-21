import { redirect } from "next/navigation";
import { currentAccountAccess } from "@/lib/access";
import { TablesBrowser } from "@/components/app/tables-browser";

export const metadata = { title: "Tables" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  return <TablesBrowser databaseId={id} readOnly={access.actor.role === "viewer"} />;
}

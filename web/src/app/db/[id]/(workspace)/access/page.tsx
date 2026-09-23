import { notFound, redirect } from "next/navigation";
import { AccessPanel } from "@/components/app/access-panel";
import { can, currentAccountAccess } from "@/lib/access";

export const metadata = { title: "Access" };

export default async function WorkspaceAccess({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  if (!can(access.actor.role, "manage_access")) notFound();
  return <AccessPanel access={access} />;
}

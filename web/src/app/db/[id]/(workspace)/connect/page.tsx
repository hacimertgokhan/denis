import { notFound, redirect } from "next/navigation";
import { ConnectGuide } from "@/components/app/connect-guide";
import { listApiKeys } from "@/lib/api-keys";
import { can, currentAccountAccess } from "@/lib/access";

export const metadata = { title: "Connect" };

export default async function WorkspaceConnect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  if (!can(access.actor.role, "manage_keys")) notFound();
  return <ConnectGuide database={access.database} keys={await listApiKeys(id)} />;
}

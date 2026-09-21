import { notFound } from "next/navigation";
import { ConnectGuide } from "@/components/app/connect-guide";
import { listApiKeys } from "@/lib/api-keys";
import { can, getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Connect" };

export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access || !can(access.actor.role, "manage_keys")) notFound();
  return <ConnectGuide database={access.database} keys={await listApiKeys(id)} />;
}

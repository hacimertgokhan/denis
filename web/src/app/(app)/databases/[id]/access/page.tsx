import { notFound } from "next/navigation";
import { AccessPanel } from "@/components/app/access-panel";
import { can, getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Access" };

export default async function AccessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access || !can(access.actor.role, "manage_access")) notFound();
  return <AccessPanel access={access} />;
}

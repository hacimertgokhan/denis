import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { KeysBrowser } from "@/components/app/keys-browser";

export const metadata = { title: "Keys" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  return <KeysBrowser databaseId={access.database.id} readOnly={access.actor.role === "viewer"} />;
}

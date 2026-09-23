import { redirect } from "next/navigation";
import { currentAccountAccess } from "@/lib/access";
import { KeysBrowser } from "@/components/app/keys-browser";

export const metadata = { title: "Keys" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  return <KeysBrowser databaseId={id} readOnly={access.actor.role === "viewer"} />;
}

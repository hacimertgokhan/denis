import { notFound } from "next/navigation";
import { KeysBrowser } from "@/components/app/keys-browser";
import { getOwnedDatabase } from "@/lib/databases";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Keys" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) notFound();
  return <KeysBrowser databaseId={database.id} />;
}

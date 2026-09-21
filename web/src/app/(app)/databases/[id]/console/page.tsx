import { notFound } from "next/navigation";
import { Console } from "@/components/app/console";
import { getOwnedDatabase } from "@/lib/databases";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Console" };

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) notFound();
  return <Console databaseId={database.id} />;
}

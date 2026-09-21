import { notFound } from "next/navigation";
import { DatabaseSettings } from "@/components/app/database-settings";
import { getOwnedDatabase } from "@/lib/databases";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) notFound();
  return <DatabaseSettings database={{ id: database.id, name: database.name }} />;
}

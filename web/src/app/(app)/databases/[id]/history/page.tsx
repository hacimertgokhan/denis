import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { HistoryView } from "@/components/app/history-view";

export const metadata = { title: "History" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  return <HistoryView databaseId={access.database.id} />;
}

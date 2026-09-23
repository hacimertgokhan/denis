import { redirect } from "next/navigation";
import { currentAccountAccess } from "@/lib/access";
import { HistoryView } from "@/components/app/history-view";

export const metadata = { title: "History" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  return <HistoryView databaseId={id} />;
}

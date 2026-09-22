import { notFound } from "next/navigation";
import { ExamplesGuide } from "@/components/app/examples-guide";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Examples" };

export default async function ExamplesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  const { database } = access;
  return <ExamplesGuide database={{ id: database.id, slug: database.slug, name: database.name }} />;
}

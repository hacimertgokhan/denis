import { redirect } from "next/navigation";
import { ExamplesGuide } from "@/components/app/examples-guide";
import { currentAccountAccess } from "@/lib/access";

export const metadata = { title: "Examples" };

export default async function WorkspaceExamples({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  const { database } = access;
  return <ExamplesGuide database={{ id: database.id, slug: database.slug, name: database.name }} />;
}

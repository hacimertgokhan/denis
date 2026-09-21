import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/app/site-header";
import { DatabaseTabs } from "@/components/app/database-tabs";
import { getOwnedDatabase } from "@/lib/databases";
import { requireUser } from "@/lib/session";

export default async function DatabaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) notFound();
  return (
    <>
      <SiteHeader
        crumbs={[{ label: "Databases", href: "/databases" }, { label: database.name }]}
        actions={<Badge variant="outline">{database.region}</Badge>}
      />
      <div className="border-b px-4 lg:px-6">
        <DatabaseTabs id={database.id} />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">{children}</div>
    </>
  );
}

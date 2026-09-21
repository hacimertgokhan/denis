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
      <div className="border-b">
        <div className="mx-auto max-w-[1120px] px-5 lg:px-8">
          <DatabaseTabs id={database.id} />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 p-5 lg:p-8">{children}</div>
    </>
  );
}

import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/app/site-header";
import { DatabaseTabs } from "@/components/app/database-tabs";
import { getAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

export default async function DatabaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  const { database, actor } = access;
  return (
    <>
      <SiteHeader
        crumbs={[{ label: "Databases", href: "/databases" }, { label: database.name }]}
        actions={
          <span className="flex items-center gap-2">
            <Badge variant="secondary">{actor.role}</Badge>
            <Badge variant="outline">{database.region}</Badge>
          </span>
        }
      />
      <div className="border-b">
        <div className="px-5 lg:px-8">
          <DatabaseTabs id={database.id} role={actor.role} />
        </div>
      </div>
      <div className="flex w-full flex-1 flex-col gap-6 px-5 py-5 lg:px-8 lg:py-8">{children}</div>
    </>
  );
}

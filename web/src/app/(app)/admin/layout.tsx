import { AdminTabs } from "@/components/app/admin-tabs";
import { SiteHeader } from "@/components/app/site-header";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/** System administration. requireAdmin() decides on the server; nothing here is reachable for ordinary users. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <SiteHeader crumbs={[{ label: "Administration" }]} />
      <div className="border-b px-5 lg:px-8">
        <AdminTabs />
      </div>
      <div className="flex w-full flex-1 flex-col gap-6 px-5 py-5 lg:px-8 lg:py-8">{children}</div>
    </>
  );
}

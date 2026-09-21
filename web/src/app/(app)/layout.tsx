import { desc, eq } from "drizzle-orm";
import { AppSidebar } from "@/components/app/app-sidebar";
import { RightSidebar } from "@/components/app/right-sidebar";
import { VerifyBanner } from "@/components/app/verify-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { listSharedDatabases } from "@/lib/access";
import { auditLabel } from "@/lib/audit-labels";
import { db, schema } from "@/lib/db";
import { listDatabases } from "@/lib/databases";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [databases, shared, activity] = await Promise.all([
    listDatabases(user.id),
    listSharedDatabases(user.id),
    db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, user.id)).orderBy(desc(schema.auditLog.createdAt)).limit(6),
  ]);
  return (
    // The whole workbench (left sidebar, content, right sidebar) sits in a
    // centred frame with side borders; the sidebar is sticky inside it.
    <div className="bg-background mx-auto min-h-svh w-full max-w-[1560px] border-x [&_[data-slot=sidebar-container]]:!sticky [&_[data-slot=sidebar-container]]:!top-0 [&_[data-slot=sidebar-container]]:!h-svh [&_[data-slot=sidebar-gap]]:!hidden">
      <SidebarProvider>
        <AppSidebar
          user={{ name: user.name, email: user.email, role: user.role }}
          databases={databases.map((d) => ({ id: d.id, name: d.name, region: d.region }))}
          shared={shared.map((s) => ({ id: s.database.id, name: s.database.name, region: s.database.region, role: s.role }))}
          maxDatabases={user.maxDatabases}
        />
        <SidebarInset className="@container/main min-w-0">
          {!user.emailVerified && <VerifyBanner email={user.email} />}
          {children}
        </SidebarInset>
        <RightSidebar activity={activity.map((a) => ({ id: a.id, label: auditLabel(a.action), detail: a.detail, at: a.createdAt.toISOString() }))} />
      </SidebarProvider>
    </div>
  );
}

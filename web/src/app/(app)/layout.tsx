import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { listDatabases } from "@/lib/databases";
import { plan } from "@/lib/env";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const databases = await listDatabases(user.id);
  return (
    <SidebarProvider>
      <AppSidebar
        user={{ name: user.name, email: user.email }}
        databases={databases.map((d) => ({ id: d.id, name: d.name, region: d.region }))}
        maxDatabases={plan().maxDatabases}
      />
      <SidebarInset className="@container/main">{children}</SidebarInset>
    </SidebarProvider>
  );
}

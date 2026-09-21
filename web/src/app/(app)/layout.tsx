import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { listDatabases } from "@/lib/databases";
import { plan } from "@/lib/env";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await requireUser();
    const databases = await listDatabases(user.id);
    return (
        // The whole workbench (sidebar + content) sits in a centred 1400px frame.
        // The sidebar is sticky inside the frame instead of fixed to the viewport.
        <div className="mx-auto min-h-svh w-full max-w-[1560px] border-x bg-background [&_[data-slot=sidebar-gap]]:!hidden [&_[data-slot=sidebar-container]]:!sticky [&_[data-slot=sidebar-container]]:!top-0 [&_[data-slot=sidebar-container]]:!h-svh">
            <SidebarProvider>
                <AppSidebar
                    user={{ name: user.name, email: user.email }}
                    databases={databases.map((d) => ({
                        id: d.id,
                        name: d.name,
                        region: d.region,
                    }))}
                    maxDatabases={plan().maxDatabases}
                />
                <SidebarInset className="@container/main min-w-0">
                    {children}
                </SidebarInset>
            </SidebarProvider>
        </div>
    );
}

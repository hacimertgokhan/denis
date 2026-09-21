"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpenIcon,
  ChartLineIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { CreateDatabaseDialog } from "@/components/app/create-database-dialog";

export type SidebarDatabase = { id: string; name: string; region: string };

const nav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon },
  { title: "Databases", url: "/databases", icon: DatabaseIcon },
  { title: "Usage", url: "/usage", icon: ChartLineIcon },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function AppSidebar({
  user,
  databases,
  shared = [],
  maxDatabases,
}: {
  user: { name: string; email: string; role?: string };
  databases: SidebarDatabase[];
  shared?: (SidebarDatabase & { role: string })[];
  maxDatabases: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile } = useSidebar();
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <DatabaseIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Denis Cloud</span>
                  <span className="text-muted-foreground truncate text-xs">free plan</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            Your databases ({databases.length}/{maxDatabases})
          </SidebarGroupLabel>
          {databases.length < maxDatabases && (
            <CreateDatabaseDialog
              trigger={
                <SidebarGroupAction title="New database">
                  <PlusIcon /> <span className="sr-only">New database</span>
                </SidebarGroupAction>
              }
            />
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {databases.map((d) => (
                <SidebarMenuItem key={d.id}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(`/databases/${d.id}`)} tooltip={d.name}>
                    <Link href={`/databases/${d.id}`}>
                      <DatabaseIcon />
                      <span>{d.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {databases.length === 0 && (
                <SidebarMenuItem>
                  <span className="text-muted-foreground px-2 text-xs">No databases yet</span>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {shared.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Shared with you</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {shared.map((d) => (
                  <SidebarMenuItem key={d.id}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(`/databases/${d.id}`)} tooltip={`${d.name} (${d.role})`}>
                      <Link href={`/databases/${d.id}`}>
                        <DatabaseIcon />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="text-muted-foreground text-[11px]">{d.role}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname.startsWith("/admin")} tooltip="Administration">
                    <Link href="/admin">
                      <ShieldCheckIcon />
                      <span>Platform</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Protocol reference">
                  <a href="https://github.com/hacimertgokhan/denis/blob/master/docs/PROTOCOL.md" target="_blank" rel="noreferrer">
                    <BookOpenIcon />
                    <span>Docs</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{initials || "U"}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="min-w-56 rounded-lg">
                <DropdownMenuLabel className="truncate font-normal">{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <SettingsIcon /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await authClient.signOut();
                    router.push("/login");
                    router.refresh();
                  }}
                >
                  <LogOutIcon /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

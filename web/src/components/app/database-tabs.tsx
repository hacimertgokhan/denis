"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Role = "owner" | "admin" | "editor" | "viewer";

const tabs: { label: string; path: string; roles?: Role[] }[] = [
  { label: "Overview", path: "" },
  { label: "Console", path: "/console" },
  { label: "Tables", path: "/tables" },
  { label: "Keys", path: "/keys" },
  { label: "History", path: "/history" },
  { label: "Connect", path: "/connect", roles: ["owner", "admin"] },
  { label: "Access", path: "/access", roles: ["owner", "admin"] },
  { label: "Settings", path: "/settings", roles: ["owner", "admin"] },
];

export function DatabaseTabs({ id, role, base: baseOverride }: { id: string; role: Role; base?: string }) {
  const pathname = usePathname();
  const base = baseOverride ?? `/databases/${id}`;
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto text-sm">
      {tabs
        .filter((t) => !t.roles || t.roles.includes(role))
        .map((t) => {
          const href = base + t.path;
          const active = t.path === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={t.label}
              href={href}
              className={cn(
                "hover:text-foreground border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors",
                active ? "border-primary text-foreground font-medium" : "text-muted-foreground border-transparent",
              )}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", path: "" },
  { label: "Users", path: "/users" },
  { label: "Databases", path: "/databases" },
  { label: "Accounts", path: "/accounts" },
  { label: "Activity", path: "/activity" },
  { label: "Announcements", path: "/announcements" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto text-sm">
      {tabs.map((t) => {
        const href = "/admin" + t.path;
        const active = t.path === "" ? pathname === "/admin" : pathname.startsWith(href);
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", path: "" },
  { label: "Console", path: "/console" },
  { label: "Tables", path: "/tables" },
  { label: "Keys", path: "/keys" },
  { label: "Connect", path: "/connect" },
  { label: "Settings", path: "/settings" },
];

export function DatabaseTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/databases/${id}`;
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto text-sm">
      {tabs.map((t) => {
        const href = base + t.path;
        const active = t.path === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.label}
            href={href}
            className={cn(
              "border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors hover:text-foreground",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

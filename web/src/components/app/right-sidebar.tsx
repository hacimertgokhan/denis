"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UPDATES } from "@/content/updates";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ActivityItem = { id: string; label: string; detail: string | null; at: string };

type Health = { ok: boolean; denis: boolean; postgres: boolean } | null;

function Dot({ ok }: { ok: boolean | null }) {
  return <span className={cn("inline-block size-1.5 rounded-full", ok === null ? "bg-muted-foreground/40" : ok ? "bg-[var(--chart-1)]" : "bg-destructive")} />;
}

/**
 * The right column of the workbench: live service status, product updates
 * and the account's recent activity. Hidden below xl.
 */
export function RightSidebar({ activity }: { activity: ActivityItem[] }) {
  const [health, setHealth] = useState<Health>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const body = (await r.json()) as Health;
        if (!cancelled) {
          setHealth(body);
          setCheckedAt(new Date());
        }
      } catch {
        if (!cancelled) setHealth({ ok: false, denis: false, postgres: false });
      }
    };
    const t = setTimeout(check, 0);
    const i = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  const rows: [string, boolean | null][] = [
    ["Denis engine", health?.denis ?? null],
    ["Platform database", health?.postgres ?? null],
    ["API and MCP", health?.ok ?? null],
  ];

  return (
    // Sticky like the left sidebar: the column stays put while the content scrolls.
    <aside className="sticky top-0 hidden h-svh w-72 shrink-0 self-start overflow-y-auto border-l xl:block">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-5 py-6 text-[13px] [&>section]:min-w-0">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Status</h2>
            <span className="text-muted-foreground text-[11.5px]">{checkedAt ? `checked ${relativeTime(checkedAt)}` : "checking…"}</span>
          </div>
          <ul className="mt-3 grid gap-2">
            {rows.map(([label, ok]) => (
              <li key={label} className="flex items-center justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Dot ok={ok} /> {ok === null ? "…" : ok ? "operational" : "down"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-medium">Updates</h2>
          <ul className="mt-3 grid gap-4">
            {UPDATES.slice(0, 4).map((u) => (
              <li key={u.version + u.title}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{u.title}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{u.version}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-[12.5px] leading-relaxed">{u.text}</p>
                {u.href && (
                  <Link
                    href={u.href}
                    {...(u.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="decoration-border hover:text-foreground mt-1 inline-block text-[12px] underline underline-offset-4"
                  >
                    Read more
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-medium">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-muted-foreground mt-3">Nothing yet.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 overflow-hidden">
                  <div className="min-w-0">
                    <div className="truncate">{a.label}</div>
                    {a.detail && <div className="text-muted-foreground truncate text-[12px]">{a.detail}</div>}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[11.5px]">{relativeTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

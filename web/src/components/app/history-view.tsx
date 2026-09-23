"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatStrip } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Entry = {
  id: string;
  actorType: "user" | "account" | "apikey";
  actorLabel: string;
  source: string;
  command: string;
  ok: boolean;
  errorCode: string | null;
  latencyMs: number;
  createdAt: string;
};
type Summary = {
  total: number;
  failed: number;
  actors: number;
  avgLatency: number;
};

const PAGE = 50;

const ACTOR: Record<Entry["actorType"], string> = {
  user: "member",
  account: "database account",
  apikey: "API key",
};

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HistoryView({ databaseId }: { databaseId: string }) {
  const [q, setQ] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Pages come from the server (LIMIT/OFFSET over the indexed log), so a
  // database with millions of commands costs one small query per page.
  const load = useCallback(
    async (target = 1) => {
      await Promise.resolve();
      setBusy(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE), page: String(target) });
        if (q.trim()) params.set("q", q.trim());
        if (failedOnly) params.set("failed", "1");
        const data = await apiFetch<{ entries: Entry[]; summary: Summary; page: number; pages: number; total: number }>(
          `/api/v1/databases/${databaseId}/history?${params}`,
        );
        setSummary(data.summary);
        setEntries(data.entries);
        setPage(data.page);
        setPages(data.pages);
        setTotal(data.total);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [databaseId, q, failedOnly],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId, failedOnly]);

  return (
    <div className="grid gap-6">
      {summary && (
        <StatStrip
          stats={[
            {
              label: "Commands, 24 h",
              value: summary.total.toLocaleString("en-US"),
            },
            {
              label: "Failed, 24 h",
              value: summary.failed.toLocaleString("en-US"),
              hint: summary.total ? `${((summary.failed / summary.total) * 100).toFixed(1)} % of commands` : undefined,
            },
            {
              label: "Distinct actors, 24 h",
              value: String(summary.actors),
            },
            {
              label: "Average latency, 24 h",
              value: summary.total ? `${summary.avgLatency.toFixed(1)} ms` : "–",
            },
          ]}
        />
      )}

      <div className="bg-card overflow-hidden rounded-lg border">
        <form
          className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void load(1);
          }}
        >
          <div className="flex min-w-64 flex-1 items-center gap-2">
            <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search commands"
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={failedOnly} onCheckedChange={(c) => setFailedOnly(c === true)} /> Failed only
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : "Search"}
          </Button>
        </form>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-[12.5px]">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Command</th>
              <th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 text-right font-medium">Latency</th>
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => (
              <tr key={e.id} className="hover:bg-muted/40 border-b align-top last:border-b-0">
                <td className="text-muted-foreground px-4 py-2 whitespace-nowrap tabular-nums">{when(e.createdAt)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div>{e.actorLabel}</div>
                  <div className="text-muted-foreground text-[11.5px]">
                    {ACTOR[e.actorType]} · {e.source}
                  </div>
                </td>
                <td className="max-w-[40rem] px-4 py-2 font-mono text-[12.5px] break-all">{e.command}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={cn("inline-flex items-center gap-1.5", e.ok ? "text-foreground" : "text-destructive")}>
                    <span className={cn("size-1.5 rounded-full", e.ok ? "bg-[var(--chart-1)]" : "bg-destructive")} />
                    {e.ok ? "ok" : (e.errorCode ?? "error")}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{e.latencyMs} ms</td>
              </tr>
            ))}
            {entries?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  No commands yet. Everything run from the console, the API or MCP shows up here.
                </td>
              </tr>
            )}
            {entries === null && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Loader2Icon className="text-muted-foreground mx-auto size-4 animate-spin" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {entries && total > 0 && (
          <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2 text-[12.5px]">
            <span className="tabular-nums">
              {(page - 1) * PAGE + 1}–{Math.min(total, page * PAGE)} of {total.toLocaleString("en-US")}
            </span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                Page {page} of {pages}
              </span>
              <Button variant="ghost" size="icon" className="size-7" disabled={busy || page <= 1} onClick={() => void load(page - 1)} aria-label="Newer">
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" disabled={busy || page >= pages} onClick={() => void load(page + 1)} aria-label="Older">
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

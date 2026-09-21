"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { Reply } from "@/components/app/reply-view";

type TableInfo = {
  name: string;
  columns: { name: string; type: string }[];
  rows: number;
};
const PAGE = 50;

async function exec(databaseId: string, command: string): Promise<Reply> {
  const data = await apiFetch<{ results: { reply: Reply }[] }>(`/api/v1/databases/${databaseId}/exec`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  return data.results[0].reply;
}

export function TablesBrowser({ databaseId, readOnly = false }: { databaseId: string; readOnly?: boolean }) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await Promise.resolve();
    setBusy(true);
    try {
      const reply = await exec(databaseId, "SHOW TABLES");
      if (!reply.ok) throw new Error(reply.error);
      const list = (reply.tables ?? []) as TableInfo[];
      setTables(list);
      if (selected && !list.some((t) => t.name === selected)) setSelected(null);
      if (!selected && list[0]) setSelected(list[0].name);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [databaseId, selected]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setBusy(true);
      try {
        const reply = await exec(databaseId, `SELECT * FROM ${selected} LIMIT ${PAGE} OFFSET ${offset}`);
        if (!cancelled) {
          if (!reply.ok) throw new Error(reply.error);
          setRows((reply.rows ?? []) as Record<string, unknown>[]);
        }
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseId, selected, offset]);

  const current = tables?.find((t) => t.name === selected) ?? null;

  async function drop(table: string) {
    const reply = await exec(databaseId, `DROP TABLE ${table}`);
    if (!reply.ok) {
      toast.error(reply.error);
      return;
    }
    toast.success(`Dropped ${table}`);
    setSelected(null);
    await load();
  }

  if (tables && tables.length === 0) {
    return (
      <EmptyState title="No tables yet">
        Create one in the{" "}
        <Link href={`/databases/${databaseId}/console`} className="underline underline-offset-4">
          console
        </Link>
        : <code className="font-mono">CREATE TABLE products (id INT, name TEXT, price REAL)</code>
      </EmptyState>
    );
  }

  return (
    <div className="bg-card grid min-h-[28rem] overflow-hidden rounded-lg border @3xl/main:grid-cols-[15rem_1fr]">
      {/* table list */}
      <div className="border-b @3xl/main:border-r @3xl/main:border-b-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-[13px] font-medium">Tables{tables ? ` · ${tables.length}` : ""}</span>
          <button type="button" onClick={() => void load()} className="text-muted-foreground hover:text-foreground" aria-label="Refresh">
            <RefreshCwIcon className={cn("size-3.5", busy && "animate-spin")} />
          </button>
        </div>
        <ul className="py-1">
          {tables?.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => {
                  setSelected(t.name);
                  setOffset(0);
                }}
                className={cn(
                  "hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[13.5px] transition-colors",
                  selected === t.name && "bg-muted font-medium",
                )}
              >
                <span className="truncate font-mono">{t.name}</span>
                <span className="text-muted-foreground text-[12px] tabular-nums">{t.rows}</span>
              </button>
            </li>
          ))}
          {!tables && (
            <li className="text-muted-foreground px-4 py-2 text-[13px]">
              <Loader2Icon className="size-4 animate-spin" />
            </li>
          )}
        </ul>
      </div>

      {/* rows */}
      <div className="flex min-w-0 flex-col">
        {current ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
              <div className="min-w-0">
                <span className="font-mono text-[13.5px] font-medium">{current.name}</span>
                <span className="text-muted-foreground ml-3 font-mono text-[12px]">{current.columns.map((c) => `${c.name} ${c.type}`).join(" · ")}</span>
              </div>
              {!readOnly && (
                <ConfirmDialog
                  title={`Drop ${current.name}?`}
                  description="Every row is deleted. This cannot be undone."
                  confirmLabel="Drop table"
                  onConfirm={() => drop(current.name)}
                  trigger={
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      Drop table
                    </Button>
                  }
                />
              )}
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-[12.5px]">
                    {current.columns.map((c) => (
                      <th key={c.name} className="px-4 py-2 font-medium">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/40 border-b last:border-b-0">
                      {current.columns.map((c) => (
                        <td key={c.name} className="px-4 py-2 font-mono text-[13px] tabular-nums">
                          {r[c.name] === null || r[c.name] === undefined ? <span className="text-muted-foreground">NULL</span> : String(r[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={current.columns.length} className="text-muted-foreground px-4 py-8 text-center text-[13.5px]">
                        {busy ? <Loader2Icon className="mx-auto size-4 animate-spin" /> : "No rows"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-[12.5px]">
              <span>{rows.length ? `Rows ${offset + 1}–${offset + rows.length} of ${current.rows}` : `0 of ${current.rows}`}</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={offset + PAGE >= current.rows}
                  onClick={() => setOffset(offset + PAGE)}
                  aria-label="Next page"
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-[13.5px]">Select a table</div>
        )}
      </div>
    </div>
  );
}

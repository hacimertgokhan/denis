"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, RefreshCwIcon, TableIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { apiFetch } from "@/lib/client-api";
import type { Reply } from "@/components/app/reply-view";

type TableInfo = { name: string; columns: { name: string; type: string }[]; rows: number };
const PAGE = 50;

async function exec(databaseId: string, command: string): Promise<Reply> {
  const data = await apiFetch<{ results: { reply: Reply }[] }>(`/api/v1/databases/${databaseId}/exec`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  return data.results[0].reply;
}

export function TablesBrowser({ databaseId }: { databaseId: string }) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await Promise.resolve(); // leave the render/effect phase before touching state
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
    // initial load, deferred out of the effect body
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
    toast.success(`Table ${table} dropped`);
    setSelected(null);
    await load();
  }

  return (
    <div className="grid gap-4 @4xl/main:grid-cols-[16rem_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Tables
            <Button variant="ghost" size="icon" className="size-7" onClick={() => void load()} aria-label="Refresh">
              <RefreshCwIcon className={busy ? "animate-spin" : ""} />
            </Button>
          </CardTitle>
          <CardDescription>{tables ? `${tables.length} table(s)` : "Loading…"}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {tables?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No tables. Run <code className="font-mono">CREATE TABLE …</code> in the console.
            </p>
          )}
          {tables?.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setSelected(t.name);
                setOffset(0);
              }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${selected === t.name ? "bg-muted font-medium" : ""}`}
            >
              <TableIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{t.name}</span>
              <Badge variant="secondary" className="ml-auto tabular-nums">
                {t.rows}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            {current ? current.name : "Select a table"}
            {current && (
              <ConfirmDialog
                title={`Drop table ${current.name}?`}
                description="All rows are deleted. This cannot be undone."
                confirmLabel="Drop table"
                onConfirm={() => drop(current.name)}
                trigger={
                  <Button variant="outline" size="sm">
                    <Trash2Icon /> Drop
                  </Button>
                }
              />
            )}
          </CardTitle>
          {current && (
            <CardDescription className="font-mono text-xs">{current.columns.map((c) => `${c.name} ${c.type}`).join(", ")}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {current && (
            <>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {current.columns.map((c) => (
                        <TableHead key={c.name}>{c.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i}>
                        {current.columns.map((c) => (
                          <TableCell key={c.name} className="tabular-nums">
                            {r[c.name] === null || r[c.name] === undefined ? <span className="text-muted-foreground">NULL</span> : String(r[c.name])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={current.columns.length} className="text-center text-muted-foreground">
                          {busy ? <Loader2Icon className="mx-auto animate-spin" /> : "No rows"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Rows {rows.length ? offset + 1 : 0}–{offset + rows.length} of {current.rows}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon" className="size-8" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    <ChevronLeftIcon />
                  </Button>
                  <Button variant="outline" size="icon" className="size-8" disabled={offset + PAGE >= current.rows} onClick={() => setOffset(offset + PAGE)}>
                    <ChevronRightIcon />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Reply = {
  ok: boolean;
  message?: string;
  error?: string;
  code?: string;
  key?: string;
  data?: string | null;
  exists?: boolean;
  keys?: string[];
  count?: number;
  values?: Record<string, string | null>;
  type?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  tables?: {
    name: string;
    columns: { name: string; type: string }[];
    rows: number;
  }[];
  affected?: number;
  token?: string;
  commands?: { name: string; usage: string; description: string }[];
  [k: string]: unknown;
};

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">NULL</span>;
  if (typeof v === "object") return <code className="text-xs">{JSON.stringify(v)}</code>;
  return String(v);
}

/** Render a Denis JSON reply the way a person wants to see it. */
export function ReplyView({ reply }: { reply: Reply }) {
  if (!reply.ok) {
    return (
      <div className="text-destructive flex items-start gap-2 text-sm">
        <Badge variant="destructive">{reply.code ?? "error"}</Badge>
        <span>{reply.error ?? "command failed"}</span>
      </div>
    );
  }
  if (Array.isArray(reply.rows)) {
    const columns = reply.columns?.length ? reply.columns : reply.rows[0] ? Object.keys(reply.rows[0]) : [];
    return (
      <div className="grid gap-2">
        {reply.rows.length === 0 ? (
          <span className="text-muted-foreground text-sm">no rows</span>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reply.rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c} className="tabular-nums">
                        {cell(r[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <span className="text-muted-foreground text-xs">{reply.rows.length} row(s)</span>
      </div>
    );
  }
  if (Array.isArray(reply.tables)) {
    return reply.tables.length === 0 ? (
      <span className="text-muted-foreground text-sm">no tables</span>
    ) : (
      <ul className="grid gap-1 text-sm">
        {reply.tables.map((t) => (
          <li key={t.name}>
            <span className="font-medium">{t.name}</span> <span className="text-muted-foreground">({t.rows} rows)</span>:{" "}
            <span className="font-mono text-xs">{t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(reply.keys)) {
    return reply.keys.length === 0 ? (
      <span className="text-muted-foreground text-sm">(empty)</span>
    ) : (
      <div className="flex flex-wrap gap-1">
        {reply.keys.map((k) => (
          <Badge key={k} variant="secondary" className="font-mono">
            {k}
          </Badge>
        ))}
      </div>
    );
  }
  if (reply.values && typeof reply.values === "object") {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {Object.entries(reply.values).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground font-mono">{k}</dt>
            <dd className="font-mono break-all">{v === null ? <span className="text-muted-foreground">(nil)</span> : v}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (Array.isArray(reply.commands)) {
    return (
      <dl className="grid gap-1 text-sm">
        {reply.commands.map((c) => (
          <div key={c.name} className="grid gap-0.5 sm:grid-cols-[minmax(0,22rem)_1fr]">
            <dt className="font-mono text-xs">{c.usage}</dt>
            <dd className="text-muted-foreground">{c.description}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if ("exists" in reply) {
    return <span className="font-mono text-sm">{reply.exists ? "true" : "false"}</span>;
  }
  if ("data" in reply && "key" in reply) {
    return <pre className="font-mono text-sm break-all whitespace-pre-wrap">{reply.data === null ? "(nil)" : String(reply.data)}</pre>;
  }
  if (reply.type === "affected") {
    return (
      <span className="text-sm">
        <Badge variant="outline">OK</Badge> {reply.message}
      </span>
    );
  }
  if (typeof reply.message === "string" && Object.keys(reply).length <= 3) {
    return (
      <span className="text-sm">
        <Badge variant="outline">OK</Badge> {reply.message}
      </span>
    );
  }
  const rest = Object.fromEntries(Object.entries(reply).filter(([k]) => k !== "ok"));
  return <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(rest, null, 2)}</pre>;
}

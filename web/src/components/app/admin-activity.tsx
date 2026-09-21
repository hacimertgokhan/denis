"use client";

import Link from "next/link";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, when } from "@/components/app/data-table";
import { auditLabel } from "@/lib/audit-labels";
import { cn } from "@/lib/utils";

export type AuditRow = {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
  userEmail: string | null;
  databaseName: string | null;
  databaseId: string | null;
};
export type CommandRow = {
  id: string;
  command: string;
  ok: boolean;
  latencyMs: number;
  source: string;
  actorType: string;
  actorLabel: string;
  createdAt: string;
  databaseId: string;
  databaseName: string;
};

export function AdminActivity({ audit, commands, compact = false }: { audit: AuditRow[]; commands: CommandRow[]; compact?: boolean }) {
  const [tab, setTab] = useState<"audit" | "commands">("audit");
  const pageSize = compact ? 10 : 25;
  const toolbar = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <TabsList className="h-8">
        <TabsTrigger value="audit" className="text-[12.5px]">
          Actions
        </TabsTrigger>
        <TabsTrigger value="commands" className="text-[12.5px]">
          Commands
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (tab === "commands") {
    return (
      <DataTable
        rows={commands}
        rowKey={(c) => c.id}
        pageSize={pageSize}
        searchable={compact ? undefined : (c) => `${c.command} ${c.actorLabel} ${c.databaseName} ${c.source}`}
        placeholder="Command, actor or database"
        toolbar={toolbar}
        empty="No commands recorded yet."
        columns={[
          {
            key: "cmd",
            header: "Command",
            cell: (c) => (
              <span className="inline-flex max-w-[40ch] items-center gap-2 font-mono text-[12.5px]">
                <span className={cn("size-1.5 shrink-0 rounded-full", c.ok ? "bg-[var(--chart-1)]" : "bg-destructive")} />
                <span className="truncate">{c.command}</span>
              </span>
            ),
          },
          {
            key: "db",
            header: "Database",
            cell: (c) => (
              <Link href={`/databases/${c.databaseId}/history`} className="hover:underline">
                {c.databaseName}
              </Link>
            ),
          },
          {
            key: "actor",
            header: "Actor",
            hideBelow: "@2xl/main",
            cell: (c) => (
              <span>
                {c.actorLabel} <span className="text-muted-foreground text-[12px]">· {c.actorType}</span>
              </span>
            ),
          },
          { key: "via", header: "Via", hideBelow: "@3xl/main", cell: (c) => c.source },
          { key: "ms", header: "Latency", className: "tabular-nums", hideBelow: "@3xl/main", cell: (c) => `${c.latencyMs} ms` },
          { key: "at", header: "When", className: "whitespace-nowrap", cell: (c) => when(c.createdAt) },
        ]}
      />
    );
  }

  return (
    <DataTable
      rows={audit}
      rowKey={(a) => a.id}
      pageSize={pageSize}
      searchable={compact ? undefined : (a) => `${auditLabel(a.action)} ${a.action} ${a.detail ?? ""} ${a.userEmail ?? ""} ${a.databaseName ?? ""}`}
      placeholder="Action, detail or email"
      toolbar={toolbar}
      empty="Nothing has happened yet."
      columns={[
        {
          key: "action",
          header: "Action",
          cell: (a) => (
            <div className="min-w-0">
              <div>{auditLabel(a.action)}</div>
              {a.detail && <div className="text-muted-foreground truncate text-[12.5px]">{a.detail}</div>}
            </div>
          ),
        },
        { key: "who", header: "By", cell: (a) => a.userEmail ?? <span className="text-muted-foreground">system</span> },
        {
          key: "db",
          header: "Database",
          hideBelow: "@2xl/main",
          cell: (a) =>
            a.databaseId && a.databaseName ? (
              <Link href={`/databases/${a.databaseId}`} className="hover:underline">
                {a.databaseName}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        { key: "at", header: "When", className: "whitespace-nowrap", cell: (a) => when(a.createdAt) },
      ]}
    />
  );
}

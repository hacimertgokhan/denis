"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, when } from "@/components/app/data-table";
import { apiFetch } from "@/lib/client-api";
import { formatBytes, formatNumber, percent, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AdminDatabase = {
  id: string;
  name: string;
  slug: string;
  region: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  maxBytes: number;
  maxKeys: number;
  opsPerDay: number;
  persistedBytes: number;
  persistedKeys: number;
  usageSampledAt: string | null;
  createdAt: string;
  keys: number;
  accounts: number;
  members: number;
  commands24h: number;
};

function Meter({ used, max }: { used: number; max: number }) {
  const p = percent(used, max);
  return (
    <div className="bg-muted mt-1 h-1 w-24 overflow-hidden rounded-full">
      <div className={cn("h-full", p >= 80 ? "bg-destructive" : "bg-[var(--chart-1)]")} style={{ width: `${Math.max(2, p)}%` }} />
    </div>
  );
}

export function AdminDatabases({ databases }: { databases: AdminDatabase[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminDatabase | null>(null);
  const [form, setForm] = useState({ maxMb: "", maxKeys: "", opsPerDay: "" });
  const [deleting, setDeleting] = useState<AdminDatabase | null>(null);

  function openEdit(d: AdminDatabase) {
    setEditing(d);
    setForm({ maxMb: String(Math.round(d.maxBytes / 1024 / 1024)), maxKeys: String(d.maxKeys), opsPerDay: String(d.opsPerDay) });
  }

  async function saveLimits() {
    if (!editing) return;
    try {
      await apiFetch(`/api/admin/databases/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ maxBytes: Number(form.maxMb) * 1024 * 1024, maxKeys: Number(form.maxKeys), opsPerDay: Number(form.opsPerDay) }),
      });
      toast.success(`Limits of ${editing.name} updated`);
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <DataTable
        rows={databases}
        rowKey={(d) => d.id}
        searchable={(d) => `${d.name} ${d.ownerEmail} ${d.ownerName} ${d.id} ${d.region}`}
        placeholder="Database, owner or id"
        columns={[
          {
            key: "db",
            header: "Database",
            cell: (d) => (
              <div className="min-w-0">
                <Link href={`/databases/${d.id}`} className="font-medium hover:underline">
                  {d.name}
                </Link>
                <div className="text-muted-foreground truncate font-mono text-[11.5px]">
                  {d.id} · {d.region}
                </div>
              </div>
            ),
          },
          {
            key: "owner",
            header: "Owner",
            cell: (d) => (
              <div className="min-w-0">
                <div className="truncate">{d.ownerName}</div>
                <div className="text-muted-foreground truncate text-[12.5px]">{d.ownerEmail}</div>
              </div>
            ),
          },
          {
            key: "storage",
            header: "Storage",
            className: "tabular-nums",
            cell: (d) => (
              <div>
                {formatBytes(d.persistedBytes)} <span className="text-muted-foreground">/ {formatBytes(d.maxBytes)}</span>
                <Meter used={d.persistedBytes} max={d.maxBytes} />
              </div>
            ),
          },
          {
            key: "keys",
            header: "Keys",
            className: "tabular-nums",
            hideBelow: "@2xl/main",
            cell: (d) => (
              <div>
                {formatNumber(d.persistedKeys)} <span className="text-muted-foreground">/ {formatNumber(d.maxKeys)}</span>
                <Meter used={d.persistedKeys} max={d.maxKeys} />
              </div>
            ),
          },
          {
            key: "ops",
            header: "Commands, 24 h",
            className: "tabular-nums",
            hideBelow: "@3xl/main",
            cell: (d) => (
              <span>
                {formatNumber(d.commands24h)} <span className="text-muted-foreground">/ {formatNumber(d.opsPerDay)}</span>
              </span>
            ),
          },
          {
            key: "creds",
            header: "Access",
            hideBelow: "@4xl/main",
            cell: (d) => (
              <span className="text-muted-foreground text-[12.5px]">
                {d.keys} keys · {d.accounts} accounts · {d.members} members
              </span>
            ),
          },
          { key: "created", header: "Created", hideBelow: "@5xl/main", cell: (d) => when(d.createdAt) },
          {
            key: "actions",
            header: "",
            className: "w-10 text-right",
            cell: (d) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="Database actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => openEdit(d)}>Change limits…</DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/databases/${d.id}/history`}>Command history</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                    Delete database
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
        footer={
          databases.length > 0 && (
            <span>
              Usage sampled{" "}
              {relativeTime(
                databases
                  .map((d) => d.usageSampledAt)
                  .filter(Boolean)
                  .sort()
                  .at(-1) ?? null,
              )}
            </span>
          )
        }
      />

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Limits of {editing?.name}</DialogTitle>
            <DialogDescription>Storage and key limits are enforced by the engine; the daily command budget by the gateway.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-mb">Storage (MB)</Label>
              <Input id="l-mb" type="number" min={1} value={form.maxMb} onChange={(e) => setForm({ ...form, maxMb: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-keys">Keys</Label>
              <Input id="l-keys" type="number" min={1} value={form.maxKeys} onChange={(e) => setForm({ ...form, maxKeys: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-ops">Commands per day</Label>
              <Input id="l-ops" type="number" min={1} value={form.opsPerDay} onChange={(e) => setForm({ ...form, opsPerDay: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveLimits()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description={`Owned by ${deleting.ownerEmail}. Every key, table, API key and account of this database is removed. This cannot be undone.`}
          confirmLabel="Delete database"
          onConfirm={async () => {
            await apiFetch(`/api/admin/databases/${deleting.id}`, { method: "DELETE" });
            toast.success(`Deleted ${deleting.name}`);
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

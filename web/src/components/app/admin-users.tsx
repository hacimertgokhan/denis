"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontalIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, when } from "@/components/app/data-table";
import { apiFetch } from "@/lib/client-api";
import { formatBytes, relativeTime } from "@/lib/format";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: string | null;
  maxDatabases: number | null;
  createdAt: string;
  databases: number;
  storedBytes: number;
  lastSeenAt: string | null;
};

export function AdminUsers({ users, meId, planMax }: { users: AdminUser[]; meId: string; planMax: number }) {
  const router = useRouter();
  const [limitFor, setLimitFor] = useState<AdminUser | null>(null);
  const [limit, setLimit] = useState("");

  async function patch(user: AdminUser, body: Record<string, unknown>, message: string) {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(message);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        searchable={(u) => `${u.name} ${u.email} ${u.role}`}
        placeholder="Name or email"
        rowClassName={(u) => (u.disabledAt ? "text-muted-foreground" : undefined)}
        columns={[
          {
            key: "user",
            header: "User",
            cell: (u) => (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{u.name}</span>
                  {u.role === "admin" && <ShieldCheckIcon className="size-3.5 shrink-0" aria-label="Administrator" />}
                  {u.id === meId && <span className="text-muted-foreground text-[11.5px]">you</span>}
                </div>
                <div className="text-muted-foreground truncate text-[12.5px]">{u.email}</div>
              </div>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (u) =>
              u.disabledAt ? (
                <Badge variant="outline">suspended {relativeTime(u.disabledAt)}</Badge>
              ) : (
                <Badge variant="secondary" className="capitalize">
                  {u.role}
                </Badge>
              ),
          },
          {
            key: "databases",
            header: "Databases",
            className: "tabular-nums",
            cell: (u) => (
              <span>
                {u.databases} / {u.maxDatabases ?? planMax}
                {u.maxDatabases !== null && <span className="text-muted-foreground ml-1 text-[11.5px]">custom</span>}
              </span>
            ),
          },
          { key: "storage", header: "Stored", className: "tabular-nums", hideBelow: "@2xl/main", cell: (u) => formatBytes(u.storedBytes) },
          { key: "seen", header: "Last seen", hideBelow: "@3xl/main", cell: (u) => (u.lastSeenAt ? relativeTime(u.lastSeenAt) : "never") },
          { key: "joined", header: "Joined", hideBelow: "@4xl/main", cell: (u) => when(u.createdAt) },
          {
            key: "actions",
            header: "",
            className: "w-10 text-right",
            cell: (u) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label="User actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setLimitFor(u);
                      setLimit(u.maxDatabases === null ? "" : String(u.maxDatabases));
                    }}
                  >
                    Database limit…
                  </DropdownMenuItem>
                  {u.id !== meId && (
                    <>
                      <DropdownMenuItem
                        onSelect={() =>
                          void patch(
                            u,
                            { role: u.role === "admin" ? "user" : "admin" },
                            u.role === "admin" ? `${u.email} is a regular user` : `${u.email} is now an administrator`,
                          )
                        }
                      >
                        {u.role === "admin" ? "Remove administrator" : "Make administrator"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={u.disabledAt ? undefined : "destructive"}
                        onSelect={() => void patch(u, { disabled: !u.disabledAt }, u.disabledAt ? `${u.email} restored` : `${u.email} suspended`)}
                      >
                        {u.disabledAt ? "Restore account" : "Suspend account"}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />

      <Dialog open={limitFor !== null} onOpenChange={(o) => !o && setLimitFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Database limit</DialogTitle>
            <DialogDescription>
              How many databases {limitFor?.email} may create. Leave empty for the plan default ({planMax}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="limit">Maximum databases</Label>
            <Input id="limit" type="number" min={0} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={String(planMax)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!limitFor) return;
                const value = limit.trim() === "" ? null : Number(limit);
                await patch(limitFor, { maxDatabases: value }, "Limit updated");
                setLimitFor(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

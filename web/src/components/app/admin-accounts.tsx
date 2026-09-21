"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, when } from "@/components/app/data-table";
import { apiFetch } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";

export type AdminAccount = {
  id: string;
  username: string;
  role: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  databaseId: string;
  databaseName: string;
  ownerEmail: string;
};

export function AdminAccounts({ accounts }: { accounts: AdminAccount[] }) {
  const router = useRouter();

  async function call(path: string, init: RequestInit, message: string) {
    try {
      await apiFetch(path, init);
      toast.success(message);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <DataTable
      rows={accounts}
      rowKey={(a) => a.id}
      searchable={(a) => `${a.username} ${a.databaseName} ${a.ownerEmail} ${a.role}`}
      placeholder="Username, database or owner"
      rowClassName={(a) => (a.disabledAt ? "text-muted-foreground" : undefined)}
      empty="No database accounts have been created yet."
      columns={[
        {
          key: "user",
          header: "Username",
          cell: (a) => (
            <span className="inline-flex items-center gap-2 font-mono">
              <KeyRoundIcon className="text-muted-foreground size-3.5" />
              {a.username}
            </span>
          ),
        },
        {
          key: "db",
          header: "Database",
          cell: (a) => (
            <div className="min-w-0">
              <Link href={`/databases/${a.databaseId}/access`} className="hover:underline">
                {a.databaseName}
              </Link>
              <div className="text-muted-foreground truncate text-[12.5px]">{a.ownerEmail}</div>
            </div>
          ),
        },
        {
          key: "role",
          header: "Role",
          cell: (a) => (
            <Badge variant="secondary" className="capitalize">
              {a.role}
            </Badge>
          ),
        },
        {
          key: "status",
          header: "Status",
          cell: (a) => (
            <span className="inline-flex items-center gap-1.5 text-[12.5px]">
              <span className={a.disabledAt ? "bg-muted-foreground/40 size-1.5 rounded-full" : "size-1.5 rounded-full bg-[var(--chart-1)]"} />
              {a.disabledAt ? "Suspended" : "Active"}
            </span>
          ),
        },
        { key: "login", header: "Last sign-in", hideBelow: "@2xl/main", cell: (a) => (a.lastLoginAt ? relativeTime(a.lastLoginAt) : "never") },
        { key: "created", header: "Created", hideBelow: "@3xl/main", cell: (a) => when(a.createdAt) },
        {
          key: "actions",
          header: "",
          className: "w-10 text-right",
          cell: (a) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Account actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    void call(
                      `/api/admin/accounts/${a.id}`,
                      { method: "PATCH", body: JSON.stringify({ disabled: !a.disabledAt }) },
                      a.disabledAt ? `${a.username} restored` : `${a.username} suspended`,
                    )
                  }
                >
                  {a.disabledAt ? "Restore" : "Suspend"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void call(`/api/admin/accounts/${a.id}`, { method: "DELETE" }, `Deleted ${a.username}`)}
                >
                  Delete account
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
      ]}
    />
  );
}

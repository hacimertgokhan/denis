"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SectionRow } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";

export function DatabaseSettings({ database }: { database: { id: string; name: string; region: string; createdAt: string } }) {
  const router = useRouter();
  const [name, setName] = useState(database.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/databases/${database.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      toast.success("Name saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionRow title="Name" description="Shown in the console and used as the MCP server name.">
        <form
          className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="name">Database name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
          </div>
          <Button type="submit" variant="outline" disabled={busy || !name.trim() || name === database.name}>
            {busy && <Loader2Icon className="animate-spin" />} Save name
          </Button>
        </form>
      </SectionRow>

      <SectionRow title="Details">
        <dl className="max-w-md divide-y rounded-lg border text-[14px]">
          <div className="flex items-center justify-between gap-6 px-4 py-2.5">
            <dt className="text-muted-foreground">Database id</dt>
            <dd className="font-mono text-[13px]">{database.id}</dd>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-2.5">
            <dt className="text-muted-foreground">Region</dt>
            <dd>{database.region}</dd>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-2.5">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{new Date(database.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</dd>
          </div>
        </dl>
      </SectionRow>

      <SectionRow title="Empty the database" description="Deletes every key and table. API keys and the database itself stay.">
        <ConfirmDialog
          title="Empty this database?"
          description="Every key and table is deleted. API keys keep working."
          confirmLabel="Empty database"
          confirmText={database.name}
          onConfirm={async () => {
            try {
              await apiFetch(`/api/v1/databases/${database.id}`, { method: "PATCH", body: JSON.stringify({ action: "reset" }) });
              toast.success("Database emptied");
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
          trigger={<Button variant="outline">Empty database</Button>}
        />
      </SectionRow>

      <SectionRow title="Delete the database" description="Removes the data, the API keys and the usage history. This cannot be undone.">
        <ConfirmDialog
          title="Delete this database?"
          description="All data, keys and history are removed permanently."
          confirmLabel="Delete database"
          confirmText={database.name}
          onConfirm={async () => {
            try {
              await apiFetch(`/api/v1/databases/${database.id}`, { method: "DELETE" });
              toast.success("Database deleted");
              router.push("/databases");
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
          trigger={
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
              Delete database
            </Button>
          }
        />
      </SectionRow>
    </div>
  );
}

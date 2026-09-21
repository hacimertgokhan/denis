"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { apiFetch } from "@/lib/client-api";

export function DatabaseSettings({ database }: { database: { id: string; name: string } }) {
  const router = useRouter();
  const [name, setName] = useState(database.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/databases/${database.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      toast.success("Renamed");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>Shown in the console and used for the MCP server name.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="name">Database name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={() => void rename()} disabled={busy || !name.trim() || name === database.name}>
            {busy && <Loader2Icon className="animate-spin" />} Save
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>These actions cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">Empty the database</div>
              <div className="text-sm text-muted-foreground">Delete every key and table; API keys and the database stay.</div>
            </div>
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
              trigger={<Button variant="outline">Empty</Button>}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">Delete the database</div>
              <div className="text-sm text-muted-foreground">Removes the data, the API keys and the usage history.</div>
            </div>
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
              trigger={<Button variant="destructive">Delete</Button>}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

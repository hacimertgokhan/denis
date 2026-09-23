"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page-primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CodeBlock } from "@/components/app/code-block";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { apiFetch } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";

export type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function ApiKeys({ databaseId, keys }: { databaseId: string; keys: KeyRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    try {
      const data = await apiFetch<{ secret: string }>(`/api/v1/databases/${databaseId}/keys`, {
        method: "POST",
        body: JSON.stringify({ name, scope }),
      });
      setSecret(data.secret);
      setName("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await apiFetch(`/api/v1/databases/${databaseId}/keys/${id}`, {
        method: "DELETE",
      });
      toast.success("Key revoked");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <Panel
      title="API keys"
      description={`${active.length} active. Revoking a key also invalidates the JWTs issued for it.`}
      bodyClassName="p-0"
      actions={
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setSecret(null);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <PlusIcon /> New key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {secret ? (
              <>
                <DialogHeader>
                  <DialogTitle>Copy your key now</DialogTitle>
                  <DialogDescription>It is shown once. Store it in a secret manager or an environment variable.</DialogDescription>
                </DialogHeader>
                <CodeBlock code={secret} title="API key" />
                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>New API key</DialogTitle>
                  <DialogDescription>Keys authenticate the REST API, the token endpoint and the MCP endpoint for this database.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="key-name">Name</Label>
                    <Input
                      id="key-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="production, claude-desktop, …"
                      maxLength={48}
                      autoFocus
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Scope</Label>
                    <Select value={scope} onValueChange={(v) => setScope(v as "read" | "write")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="write">Read and write</SelectItem>
                        <SelectItem value="read">Read only (safe for AI assistants)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => void create()} disabled={busy || !name.trim()}>
                    {busy && <Loader2Icon className="animate-spin" />} Create key
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      }
    >
      {keys.length === 0 ? (
        <p className="text-muted-foreground p-5 text-[13.5px]">No keys yet. Create one to use the API or MCP.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id} className={k.revokedAt ? "opacity-50" : ""}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <KeyIcon className="text-muted-foreground size-3.5" /> {k.name}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                <TableCell>
                  <Badge variant={k.scope === "read" ? "secondary" : "outline"}>{k.scope}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{relativeTime(k.lastUsedAt)}</TableCell>
                <TableCell className="text-muted-foreground">{relativeTime(k.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {k.revokedAt ? (
                    <Badge variant="destructive">revoked</Badge>
                  ) : (
                    <ConfirmDialog
                      title={`Revoke "${k.name}"?`}
                      description="Applications and assistants using this key lose access immediately."
                      confirmLabel="Revoke"
                      onConfirm={() => revoke(k.id)}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Revoke
                        </Button>
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

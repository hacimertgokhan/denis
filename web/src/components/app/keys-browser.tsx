"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRoundIcon, Loader2Icon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client-api";
import type { Reply } from "@/components/app/reply-view";

async function exec(databaseId: string, command: string): Promise<Reply> {
  const data = await apiFetch<{ results: { reply: Reply }[] }>(`/api/v1/databases/${databaseId}/exec`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  return data.results[0].reply;
}

export function KeysBrowser({ databaseId }: { databaseId: string }) {
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");
  const [persist, setPersist] = useState(true);

  const search = useCallback(async () => {
    await Promise.resolve(); // leave the render/effect phase before touching state
    setBusy(true);
    try {
      const reply = await exec(databaseId, `KEYS ${pattern.trim() || "*"}`);
      if (!reply.ok) throw new Error(reply.error);
      setKeys(reply.keys ?? []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [databaseId, pattern]);

  useEffect(() => {
    // initial load, deferred out of the effect body
    const timer = setTimeout(() => void search(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  async function open(key: string) {
    setSelected(key);
    setValue(null);
    const reply = await exec(databaseId, `GET ${key}`);
    setValue(reply.ok ? String(reply.data) : null);
  }

  async function save() {
    const key = editKey.trim();
    if (!key || /\s/.test(key)) {
      toast.error("Keys are one word without whitespace");
      return;
    }
    if (/[\r\n]/.test(editValue) || /(^|\s)-&/.test(editValue)) {
      toast.error("Values cannot contain line breaks or a word starting with -&");
      return;
    }
    const reply = await exec(databaseId, `SET ${key} ${editValue}${persist ? " -&cache -&save" : ""}`);
    if (!reply.ok) {
      toast.error(reply.error);
      return;
    }
    toast.success(`Saved ${key}`);
    setEditOpen(false);
    await search();
    if (selected === key) await open(key);
  }

  async function remove(key: string) {
    const reply = await exec(databaseId, `DEL ${key}`);
    if (!reply.ok) {
      toast.error(reply.error);
      return;
    }
    toast.success(`Deleted ${key}`);
    if (selected === key) {
      setSelected(null);
      setValue(null);
    }
    await search();
  }

  let pretty: string | null = null;
  if (value !== null) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object") pretty = JSON.stringify(parsed, null, 2);
    } catch {
      pretty = null;
    }
  }

  return (
    <div className="grid gap-4 @4xl/main:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Keys
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditKey("");
                    setEditValue("");
                  }}
                >
                  <PlusIcon /> New
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set a key</DialogTitle>
                  <DialogDescription>Values are text; store JSON for structured data.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="k">Key</Label>
                    <Input id="k" value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder="user:42" className="font-mono" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="v">Value</Label>
                    <Textarea id="v" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="font-mono" rows={4} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={persist} onCheckedChange={(c) => setPersist(c === true)} /> Persist to disk (survives restarts)
                  </label>
                </div>
                <DialogFooter>
                  <Button onClick={() => void save()}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardTitle>
          <CardDescription>Glob pattern: * any run, ? one character</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono" />
            <Button type="submit" size="icon" variant="outline" aria-label="Search">
              {busy ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            </Button>
          </form>
          <div className="max-h-[28rem] overflow-y-auto">
            {keys.length === 0 && <p className="text-sm text-muted-foreground">No keys match.</p>}
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => void open(k)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-sm hover:bg-muted ${selected === k ? "bg-muted" : ""}`}
              >
                <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{k}</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{keys.length} key(s)</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between font-mono text-base">
            {selected ?? <span className="font-sans text-muted-foreground">Select a key</span>}
            {selected && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditKey(selected);
                    setEditValue(value ?? "");
                    setEditOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => void remove(selected)}>
                  <Trash2Icon /> Delete
                </Button>
              </div>
            )}
          </CardTitle>
          {selected && value !== null && (
            <CardDescription>
              {value.length} characters {pretty && <Badge variant="secondary">JSON</Badge>}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {selected && value === null && <Loader2Icon className="animate-spin text-muted-foreground" />}
          {value !== null && <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all">{pretty ?? value}</pre>}
        </CardContent>
      </Card>
    </div>
  );
}

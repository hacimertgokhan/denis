"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { Reply } from "@/components/app/reply-view";

async function exec(databaseId: string, command: string): Promise<Reply> {
  const data = await apiFetch<{ results: { reply: Reply }[] }>(`/api/v1/databases/${databaseId}/exec`, {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  return data.results[0].reply;
}

const MAX_KEY = 512;
const MAX_VALUE = 60 * 1024;

/** What the wire can carry: a one-word key, a single-line value with no flag words, both bounded. */
export function validateEntry(key: string, value: string): string | null {
  if (!key) return "A key is required";
  if (key.length > MAX_KEY) return `A key is at most ${MAX_KEY} characters`;
  if (/\s/.test(key)) return "A key is one word without whitespace";
  if (/[\u0000-\u001f\u007f]/.test(key)) return "A key cannot contain control characters";
  if (value.length > MAX_VALUE) return `A value is at most ${Math.round(MAX_VALUE / 1024)} KB`;
  if (/[\r\n]/.test(value)) return "A value cannot contain line breaks";
  if (/(^|\s)-&/.test(value)) return "No word of a value may start with -& (that marks a flag)";
  return null;
}

export function KeysBrowser({ databaseId, readOnly = false }: { databaseId: string; readOnly?: boolean }) {
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");
  const [persist, setPersist] = useState(true);
  // KEYS answers with every match at once; only a window of it is rendered.
  const [page, setPage] = useState(0);
  const KEY_PAGE = 200;

  const search = useCallback(async () => {
    await Promise.resolve();
    setBusy(true);
    try {
      const p = pattern.trim() || "*";
      if (/\s/.test(p) || p.length > 256) throw new Error("A pattern is one word of at most 256 characters");
      const reply = await exec(databaseId, `KEYS ${p}`);
      if (!reply.ok) throw new Error(reply.error);
      setKeys(reply.keys ?? []);
      setPage(0);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [databaseId, pattern]);

  useEffect(() => {
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

  function startEdit(key = "", initial = "") {
    setEditKey(key);
    setEditValue(initial);
    setEditOpen(true);
  }

  async function save() {
    const key = editKey.trim();
    const problem = validateEntry(key, editValue);
    if (problem) {
      toast.error(problem);
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
    await open(key);
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
    <>
      <div className="bg-card grid min-h-[28rem] overflow-hidden rounded-lg border @3xl/main:grid-cols-[18rem_1fr]">
        {/* key list */}
        <div className="flex flex-col border-b @3xl/main:border-r @3xl/main:border-b-0">
          <form
            className="flex items-center gap-2 border-b px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
              placeholder="user:*"
              aria-label="Key pattern"
            />
            {!readOnly && (
              <button type="button" onClick={() => startEdit()} className="text-muted-foreground hover:text-foreground" aria-label="New key">
                <PlusIcon className="size-4" />
              </button>
            )}
          </form>
          <ul className="max-h-[32rem] flex-1 overflow-y-auto py-1">
            {keys === null && (
              <li className="px-4 py-2">
                <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
              </li>
            )}
            {keys?.length === 0 && <li className="text-muted-foreground px-4 py-3 text-[13px]">No keys match. Patterns: * any run, ? one character.</li>}
            {keys?.slice(page * KEY_PAGE, page * KEY_PAGE + KEY_PAGE).map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => void open(k)}
                  className={cn(
                    "hover:bg-muted/60 w-full truncate px-4 py-1.5 text-left font-mono text-[13px] transition-colors",
                    selected === k && "bg-muted font-medium",
                  )}
                >
                  {k}
                </button>
              </li>
            ))}
          </ul>
          <div className="text-muted-foreground flex items-center justify-between border-t px-4 py-1.5 text-[12px]">
            <span>{keys ? `${keys.length.toLocaleString("en-US")} key(s)` : busy ? "Searching…" : ""}</span>
            {keys && keys.length > KEY_PAGE && (
              <span className="flex items-center gap-1 tabular-nums">
                {page * KEY_PAGE + 1}–{Math.min(keys.length, (page + 1) * KEY_PAGE)}
                <Button variant="ghost" size="icon" className="size-6" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous keys">
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={(page + 1) * KEY_PAGE >= keys.length}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next keys"
                >
                  <ChevronRightIcon />
                </Button>
              </span>
            )}
          </div>
        </div>

        {/* value */}
        <div className="flex min-w-0 flex-col">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
                <div className="min-w-0">
                  <span className="font-mono text-[13.5px] font-medium">{selected}</span>
                  {value !== null && (
                    <span className="text-muted-foreground ml-3 text-[12px]">
                      {value.length} characters
                      {pretty ? " · JSON" : ""}
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(selected, value ?? "")}>
                      Edit
                    </Button>
                    <ConfirmDialog
                      title={`Delete ${selected}?`}
                      description="The key is removed from the cache and the persisted store."
                      confirmLabel="Delete key"
                      onConfirm={() => remove(selected)}
                      trigger={
                        <Button variant="ghost" size="sm" className="text-muted-foreground">
                          Delete
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
              <div className="flex-1 p-4">
                {value === null ? (
                  <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                ) : (
                  <pre className="font-mono text-[13px] leading-[1.6] break-all whitespace-pre-wrap">{pretty ?? value}</pre>
                )}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-[13.5px]">Select a key to see its value</div>
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editKey && keys?.includes(editKey) ? `Edit ${editKey}` : "New key"}</DialogTitle>
            <DialogDescription>Values are text. Store JSON for structured data.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="k">Key</Label>
              <Input id="k" value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder="user:42" className="font-mono" autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="v">Value</Label>
              <Textarea id="v" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="font-mono" rows={5} />
            </div>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox checked={persist} onCheckedChange={(c) => setPersist(c === true)} /> Persist to disk (survives restarts)
            </label>
            <DialogFooter>
              <Button type="submit">Save key</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

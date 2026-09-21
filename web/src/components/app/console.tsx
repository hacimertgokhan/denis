"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, PlayIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ReplyView, type Reply } from "@/components/app/reply-view";
import { apiFetch } from "@/lib/client-api";

type Entry = { id: number; command: string; reply: Reply; latencyMs: number; at: Date };

const EXAMPLES: { label: string; command: string }[] = [
  { label: "Set a key", command: "SET greeting hello world -&save" },
  { label: "Get a key", command: "GET greeting" },
  { label: "List keys", command: "KEYS *" },
  { label: "Create table", command: "CREATE TABLE products (id INT, name TEXT, price REAL)" },
  { label: "Insert rows", command: "INSERT INTO products (id, name, price) VALUES (1, 'Pen', 2.5), (2, 'Book', 12)" },
  { label: "Query", command: "SELECT * FROM products WHERE price > 5 ORDER BY price DESC LIMIT 20" },
  { label: "Tables", command: "SHOW TABLES" },
  { label: "Server info", command: "INFO" },
  { label: "Help", command: "HELP" },
];

export function Console({ databaseId }: { databaseId: string }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(`denis:console:${databaseId}`);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const historyIndex = useRef(-1);
  const bottom = useRef<HTMLDivElement>(null);
  const storageKey = `denis:console:${databaseId}`;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  async function run(text = input) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0 || busy) return;
    setBusy(true);
    try {
      const data = await apiFetch<{ results: { command: string; reply: Reply; latencyMs: number }[] }>(`/api/v1/databases/${databaseId}/exec`, {
        method: "POST",
        body: JSON.stringify({ commands: lines }),
      });
      setEntries((prev) => [...prev, ...data.results.map((r, i) => ({ ...r, id: Date.now() + i, at: new Date() }))]);
      const next = [...lines.slice().reverse(), ...history.filter((h) => !lines.includes(h))].slice(0, 100);
      setHistory(next);
      historyIndex.current = -1;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      setInput("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !input.includes("\n")) {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "ArrowUp" && !input.includes("\n") && history.length > 0) {
      e.preventDefault();
      historyIndex.current = Math.min(history.length - 1, historyIndex.current + 1);
      setInput(history[historyIndex.current] ?? "");
    }
    if (e.key === "ArrowDown" && historyIndex.current >= 0) {
      e.preventDefault();
      historyIndex.current = Math.max(-1, historyIndex.current - 1);
      setInput(historyIndex.current === -1 ? "" : (history[historyIndex.current] ?? ""));
    }
  }

  return (
    <div className="grid gap-4 @4xl/main:grid-cols-[1fr_16rem]">
      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-6">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command — Enter to run, Shift+Enter for a new line (one command per line), ↑ for history"
              className="min-h-24 font-mono text-sm"
              spellCheck={false}
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">SQL statements can be sent as-is; the SQL prefix is optional.</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEntries([])} disabled={entries.length === 0}>
                  <Trash2Icon /> Clear
                </Button>
                <Button size="sm" onClick={() => void run()} disabled={busy || !input.trim()}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Run
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {entries.length === 0 && <p className="text-sm text-muted-foreground">Results appear here. Try one of the examples on the right.</p>}
          {entries.map((e) => (
            <Card key={e.id} className="gap-2 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-sm">{e.command}</code>
                  <span className="shrink-0 text-xs text-muted-foreground">{e.latencyMs} ms</span>
                </div>
              </CardHeader>
              <CardContent className="px-4">
                <ReplyView reply={e.reply} />
              </CardContent>
            </Card>
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Examples</CardTitle>
          <CardDescription>Click to load, then Run</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setInput(ex.command)}
              className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              title={ex.command}
            >
              <div className="font-medium">{ex.label}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{ex.command}</div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

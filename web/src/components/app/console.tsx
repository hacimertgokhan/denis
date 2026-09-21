"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { Reply } from "@/components/app/reply-view";

type Entry = { id: number; command: string; reply: Reply; latencyMs: number };

const EXAMPLES: { group: string; items: { label: string; command: string }[] }[] = [
  {
    group: "Keys",
    items: [
      { label: "Set a key", command: "SET greeting hello world -&save" },
      { label: "Get a key", command: "GET greeting" },
      { label: "Store JSON", command: 'SET user:1 {"name":"Ada","role":"admin"} -&save' },
      { label: "List keys", command: "KEYS *" },
      { label: "Several keys", command: "MGET greeting user:1" },
    ],
  },
  {
    group: "Tables",
    items: [
      { label: "Create table", command: "CREATE TABLE products (id INT, name TEXT, price REAL)" },
      { label: "Insert rows", command: "INSERT INTO products (id, name, price) VALUES (1, 'Pen', 2.5), (2, 'Book', 12)" },
      { label: "Query", command: "SELECT * FROM products WHERE price > 5 ORDER BY price DESC LIMIT 20" },
      { label: "Count", command: "SELECT COUNT(*) FROM products" },
      { label: "Tables", command: "SHOW TABLES" },
    ],
  },
  {
    group: "Server",
    items: [
      { label: "Usage and limits", command: "INFO" },
      { label: "Command reference", command: "HELP" },
    ],
  },
];

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="wb-dim">NULL</span>;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** A reply rendered inside the terminal: tables for rows, lists for keys, JSON otherwise. */
function TerminalReply({ reply }: { reply: Reply }) {
  if (!reply.ok) {
    return (
      <div className="wb-err">
        {reply.error ?? "command failed"}
        {reply.code && <span className="wb-dim"> · {reply.code}</span>}
      </div>
    );
  }
  if (Array.isArray(reply.rows)) {
    const columns = reply.columns?.length ? reply.columns : reply.rows[0] ? Object.keys(reply.rows[0]) : [];
    if (reply.rows.length === 0) return <div className="wb-dim">no rows</div>;
    return (
      <div className="overflow-x-auto">
        <table className="text-[12.5px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reply.rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="tabular-nums">
                    {cell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="wb-dim mt-1 text-[12px]">{reply.rows.length} row(s)</div>
      </div>
    );
  }
  if (Array.isArray(reply.tables)) {
    if (reply.tables.length === 0) return <div className="wb-dim">no tables</div>;
    return (
      <div>
        {reply.tables.map((t) => (
          <div key={t.name}>
            {t.name} <span className="wb-dim">({t.rows} rows) · {t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}</span>
          </div>
        ))}
      </div>
    );
  }
  if (Array.isArray(reply.keys)) {
    return reply.keys.length === 0 ? <div className="wb-dim">(empty)</div> : <div>{reply.keys.join("  ")}</div>;
  }
  if (reply.values && typeof reply.values === "object") {
    return (
      <div>
        {Object.entries(reply.values).map(([k, v]) => (
          <div key={k}>
            <span className="wb-dim">{k}</span> {v === null ? <span className="wb-dim">(nil)</span> : v}
          </div>
        ))}
      </div>
    );
  }
  if (Array.isArray(reply.commands)) {
    return (
      <div className="grid gap-0.5">
        {reply.commands.map((c) => (
          <div key={c.name} className="grid gap-x-4 md:grid-cols-[minmax(0,26rem)_1fr]">
            <span>{c.usage}</span>
            <span className="wb-dim">{c.description}</span>
          </div>
        ))}
      </div>
    );
  }
  if ("data" in reply && "key" in reply) return <div className="break-all whitespace-pre-wrap">{reply.data === null ? "(nil)" : String(reply.data)}</div>;
  if ("exists" in reply) return <div>{reply.exists ? "true" : "false"}</div>;
  if (reply.type === "affected" || (typeof reply.message === "string" && Object.keys(reply).length <= 3)) {
    return (
      <div>
        <span className="wb-prompt">ok</span> {reply.message}
      </div>
    );
  }
  const rest = Object.fromEntries(Object.entries(reply).filter(([k]) => k !== "ok"));
  return <pre className="whitespace-pre-wrap">{JSON.stringify(rest, null, 2)}</pre>;
}

export function Console({ databaseId, databaseName }: { databaseId: string; databaseName: string }) {
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
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const storageKey = `denis:console:${databaseId}`;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  // the input grows with its content, up to a few lines
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [input]);

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
      setEntries((prev) => [...prev, ...data.results.map((r, i) => ({ ...r, id: Date.now() + i }))]);
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
      textarea.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
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
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    }
  }

  const last = entries[entries.length - 1];

  return (
    <div className="grid gap-4 @4xl/main:grid-cols-[1fr_15rem]">
      <div className="wb-terminal flex h-[calc(100vh-13.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg font-mono text-[13px] leading-[1.65]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[12px]">
          <span>
            <span className="wb-dim">database</span> {databaseName} <span className="wb-dim">· MODE json</span>
          </span>
          <span className="wb-dim">
            {last ? `${last.latencyMs} ms` : ""}
            {entries.length > 0 && (
              <button type="button" onClick={() => setEntries([])} className="ml-4 hover:text-[#eceae4]">
                clear
              </button>
            )}
          </span>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-3" onClick={() => textarea.current?.focus()}>
          {entries.length === 0 && (
            <div className="wb-dim">
              Type a command and press Enter. Shift+Enter adds a line (each line runs in order), ↑ recalls history, Ctrl+L clears.
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id} className="mb-3 last:mb-0">
              <div className="flex gap-2 break-all whitespace-pre-wrap">
                <span className="wb-prompt shrink-0">{">"}</span>
                <span>{e.command}</span>
              </div>
              <div className="pl-4">
                <TerminalReply reply={e.reply} />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 border-t border-white/10 px-4 py-3">
          <span className={cn("wb-prompt pt-px", busy && "animate-pulse")}>{">"}</span>
          <textarea
            ref={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            spellCheck={false}
            autoFocus
            placeholder="SELECT * FROM products WHERE price > 10"
            className="min-h-[1.65em] flex-1 resize-none bg-transparent outline-none placeholder:text-[#5a606b]"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !input.trim()}
            className="wb-dim rounded px-2 py-0.5 text-[12px] hover:text-[#eceae4] disabled:opacity-40"
          >
            run ⏎
          </button>
        </div>
      </div>

      <aside className="hidden @4xl/main:block">
        <p className="text-[13px] font-medium">Examples</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Click to load into the prompt.</p>
        <div className="mt-4 grid gap-5">
          {EXAMPLES.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 text-[12px] text-muted-foreground">{g.group}</p>
              <div className="grid">
                {g.items.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => {
                      setInput(ex.command);
                      textarea.current?.focus();
                    }}
                    className="-mx-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-muted"
                    title={ex.command}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

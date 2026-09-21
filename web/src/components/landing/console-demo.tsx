"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A real Denis session, replayed: each line is typed, then the engine's
 * actual reply appears. Plays once on load; with reduced motion (or after it
 * has finished) the whole transcript is shown at rest. This is the only
 * animated thing on the page.
 */
type Step = { input: string; reply: string; via?: "mcp" };

const SESSION: Step[] = [
  { input: "SET greeting hello world -&save", reply: '{"ok":true,"message":"Ok (Cache, Protobuf)"}' },
  { input: "GET greeting", reply: '{"ok":true,"key":"greeting","data":"hello world"}' },
  { input: "CREATE TABLE products (id INT, name TEXT, price REAL)", reply: '{"ok":true,"type":"affected","affected":0,"message":"table created"}' },
  { input: "INSERT INTO products (id, name, price) VALUES (1, 'Pen', 2.5), (2, 'Book', 12), (3, 'Bag', 40)", reply: '{"ok":true,"type":"affected","affected":3,"message":"3 rows inserted"}' },
  { input: "SELECT name, price FROM products WHERE price > 10 ORDER BY price DESC", reply: '{"ok":true,"type":"rows","columns":["name","price"],"rows":[{"name":"Bag","price":40},{"name":"Book","price":12}],"count":2}' },
  { input: 'denis_query  sql: "SELECT COUNT(*) FROM products"', reply: '{"type":"rows","rows":[{"count":3}],"count":1}', via: "mcp" },
];

const TYPE_MS = 28;
const REPLY_MS = 260;
const PAUSE_MS = 700;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** @param autoplay false renders the finished transcript at rest (auth pages) */
export function ConsoleDemo({ autoplay = true }: { autoplay?: boolean }) {
  const reduced = usePrefersReducedMotion() || !autoplay;
  // how far the replay has gone: step index and characters typed of the current input
  const [progress, setProgress] = useState<{ step: number; chars: number; replied: boolean }>({ step: 0, chars: 0, replied: false });
  const [done, setDone] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (reduced) {
      const t = setTimeout(() => setDone(true), 0);
      return () => clearTimeout(t);
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (fn: () => void, ms: number) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };
    const run = (step: number, chars: number) => {
      if (step >= SESSION.length) {
        setDone(true);
        return;
      }
      const input = SESSION[step].input;
      if (chars < input.length) {
        setProgress({ step, chars: chars + 1, replied: false });
        schedule(() => run(step, chars + 1), TYPE_MS);
      } else {
        schedule(() => {
          setProgress({ step, chars, replied: true });
          schedule(() => run(step + 1, 0), PAUSE_MS);
        }, REPLY_MS);
      }
    };
    schedule(() => run(0, 0), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [progress, done]);

  const visible = done ? SESSION.length : progress.step + 1;

  return (
    <div
      className="overflow-hidden rounded-xl border border-black/10 bg-[var(--l-console)] text-[var(--l-console-text)] shadow-[0_24px_60px_-28px_rgba(27,30,36,0.55)]"
      aria-label="A Denis session"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 font-mono text-[12px] text-[var(--l-console-dim)]">
        <span>denis cli shell -g shop</span>
        <span>MODE json</span>
      </div>
      <div ref={scroller} className="h-[22rem] overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.7] sm:h-[24rem] sm:text-[13px]">
        {SESSION.slice(0, visible).map((step, i) => {
          const current = !done && i === progress.step;
          const typed = current ? step.input.slice(0, progress.chars) : step.input;
          const showReply = done || (current ? progress.replied : true);
          return (
            <div key={i} className="mb-3 last:mb-0">
              <div className="flex gap-2 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-[var(--l-honey)]">{step.via === "mcp" ? "mcp" : ">"}</span>
                <span>
                  {typed}
                  {current && !progress.replied && <span className="ml-0.5 inline-block h-[1.1em] w-[0.55ch] translate-y-[0.2em] bg-[var(--l-honey)]" aria-hidden />}
                </span>
              </div>
              {showReply && <div className="whitespace-pre-wrap break-all text-[var(--l-console-dim)]">{step.reply}</div>}
            </div>
          );
        })}
        {done && (
          <div className="flex gap-2">
            <span className="text-[var(--l-honey)]">{">"}</span>
            <span className="inline-block h-[1.1em] w-[0.55ch] translate-y-[0.2em] bg-[var(--l-honey)] motion-safe:animate-pulse" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}

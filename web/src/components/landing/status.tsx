"use client";

import { useEffect, useState } from "react";

/** Live service status for the footer, from /api/health. */
export function ServiceStatus() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { ok: boolean }) => !cancelled && setOk(Boolean(b.ok)))
      .catch(() => !cancelled && setOk(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <a href="/api/health" className="inline-flex items-center gap-2 transition-colors hover:text-[var(--l-ink)]">
      <span
        className={
          ok === null
            ? "inline-block size-1.5 rounded-full bg-[var(--l-line)]"
            : ok
              ? "inline-block size-1.5 rounded-full bg-[var(--l-ink)]"
              : "bg-destructive inline-block size-1.5 rounded-full"
        }
        aria-hidden
      />
      {ok === null ? "Checking status" : ok ? "All systems operational" : "Service disruption"}
    </a>
  );
}

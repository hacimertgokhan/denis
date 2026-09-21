"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide below this container width (Tailwind container query prefix, e.g. "@2xl/main"). */
  hideBelow?: string;
};

/**
 * A bordered table with a search box and page controls. Filtering and paging
 * happen in memory: the server hands over one bounded list and the browser
 * never re-fetches to move between pages.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchable,
  placeholder = "Search",
  pageSize = 25,
  empty = "Nothing here yet.",
  toolbar,
  footer,
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Text used for the search box; the table is unsearchable when omitted. */
  searchable?: (row: T) => string;
  placeholder?: string;
  pageSize?: number;
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !searchable) return rows;
    return rows.filter((r) => searchable(r).toLowerCase().includes(needle));
  }, [rows, q, searchable]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * pageSize, current * pageSize + pageSize);

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {searchable && (
            <label className="bg-background focus-within:border-ring flex h-8 min-w-56 flex-1 items-center gap-2 rounded-md border px-2.5 text-[13px] sm:flex-none sm:basis-72">
              <SearchIcon className="text-muted-foreground size-3.5" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder={placeholder}
                className="placeholder:text-muted-foreground w-full bg-transparent outline-none"
              />
            </label>
          )}
          {toolbar}
          <span className="text-muted-foreground ml-auto text-[12.5px] tabular-nums">
            {filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length}`}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-[12px]">
              {columns.map((c) => (
                <th key={c.key} className={cn("px-4 py-2.5 font-medium whitespace-nowrap", c.hideBelow && `hidden ${c.hideBelow}:table-cell`, c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-muted-foreground px-4 py-10 text-center">
                  {q ? "No rows match." : empty}
                </td>
              </tr>
            )}
            {slice.map((r) => (
              <tr key={rowKey(r)} className={cn("hover:bg-muted/40 border-b last:border-b-0", rowClassName?.(r))}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2 align-middle", c.hideBelow && `hidden ${c.hideBelow}:table-cell`, c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(pages > 1 || footer) && (
        <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-2 text-[12.5px]">
          <div>{footer}</div>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length}
              </span>
              <Button variant="ghost" size="icon" className="size-7" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
                aria-label="Next page"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

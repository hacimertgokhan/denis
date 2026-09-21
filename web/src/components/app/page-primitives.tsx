import { cn } from "@/lib/utils";

/** Page title with an optional one-line description and actions on the right. */
export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        <h1 className="text-[1.375rem] leading-tight font-medium tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-[14px]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A settings-style row: what it is on the left, the control on the right; hairline below. */
export function SectionRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 border-b py-7 last:border-b-0 md:grid-cols-[minmax(0,18rem)_1fr] md:gap-12", className)}>
      <div>
        <h2 className="text-[15px] font-medium">{title}</h2>
        {description && <p className="text-muted-foreground mt-1 max-w-[40ch] text-[13.5px] leading-relaxed">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type Stat = {
  label: string;
  value: string;
  hint?: string;
  progress?: number;
};

/** One bordered strip divided into cells, instead of a grid of cards. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="bg-card [&>*]:border-border grid divide-y overflow-hidden rounded-lg border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:[&>*:not(:first-child)]:border-l sm:[&>*:nth-child(2n)]:border-l">
      {stats.map((s) => {
        const warn = s.progress !== undefined && s.progress >= 80;
        return (
          <div key={s.label} className="px-5 py-4">
            <div className="text-muted-foreground text-[13px]">{s.label}</div>
            <div className="mt-1 text-[1.6rem] leading-none font-medium tracking-[-0.01em] tabular-nums">{s.value}</div>
            {s.progress !== undefined && (
              <div className="bg-muted mt-3 h-1 w-full overflow-hidden rounded-full">
                <div
                  className={cn("h-full rounded-full", warn ? "bg-destructive" : "bg-[var(--chart-1)]")}
                  style={{
                    width: `${Math.max(2, s.progress)}%`,
                  }}
                />
              </div>
            )}
            {s.hint && <div className="text-muted-foreground mt-2 text-[12.5px]">{s.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** A quiet bordered surface for tables and panels (no shadow, no gradient). */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("bg-card overflow-hidden rounded-lg border", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
          <div>
            {title && <h2 className="text-[15px] font-medium">{title}</h2>}
            {description && <p className="text-muted-foreground text-[13px]">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {children && <div className="text-muted-foreground mt-2 text-[14px]">{children}</div>}
    </div>
  );
}

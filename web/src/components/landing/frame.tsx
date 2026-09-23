import { cn } from "@/lib/utils";

/**
 * The landing is drawn on a ruled frame: two vertical hairlines bound the
 * content column for the whole page, every section ends on a horizontal
 * hairline that runs edge to edge, and a light beam travels along the
 * verticals now and then. Everything is CSS; see .lf-* in globals.css.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="lf-frame relative">
      <div className="lf-rail lf-rail-left" aria-hidden />
      <div className="lf-rail lf-rail-right" aria-hidden />
      {children}
    </div>
  );
}

/** One section: full-width rule below, content inside the column. */
export function Section({
  children,
  className,
  inner,
  id,
  rule = true,
}: {
  children: React.ReactNode;
  className?: string;
  inner?: string;
  id?: string;
  rule?: boolean;
}) {
  return (
    <section id={id} className={cn("relative", rule && "lf-rule", className)}>
      <div className={cn("mx-auto max-w-[1400px] px-6 lg:px-10", inner)}>{children}</div>
    </section>
  );
}

/** A small mark at the crossing of a rule and a rail, like a technical drawing. */
export function Cross({ className }: { className?: string }) {
  return <span className={cn("lf-cross", className)} aria-hidden />;
}

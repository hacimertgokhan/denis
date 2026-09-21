/**
 * Measured numbers from docs/BENCHMARKS.md drawn as paired bars, wins and
 * losses alike. Monochrome: Denis is ink, the other system is the mid grey.
 */
type Pair = { workload: string; setting: string; unit: string; denis: number; other: number; otherName: "Redis" | "PostgreSQL"; note?: string };

const PAIRS: Pair[] = [
  { workload: "SQL point read by id", setting: "10k rows, 16 clients", unit: "ops/s", denis: 20016, other: 16916, otherName: "PostgreSQL" },
  { workload: "SQL update by id", setting: "16 clients", unit: "ops/s", denis: 16801, other: 3990, otherName: "PostgreSQL" },
  { workload: "SQL delete by id", setting: "16 clients", unit: "ops/s", denis: 26567, other: 4026, otherName: "PostgreSQL" },
  { workload: "COUNT(*) on 50k rows", setting: "single client", unit: "ops/s", denis: 3159, other: 771, otherName: "PostgreSQL", note: "O(1) in Denis" },
  {
    workload: "Range scan + ORDER BY + LIMIT 20",
    setting: "single client",
    unit: "ops/s",
    denis: 398,
    other: 1216,
    otherName: "PostgreSQL",
    note: "no ordered index yet",
  },
  { workload: "SET, persisted", setting: "single client", unit: "ops/s", denis: 3310, other: 3412, otherName: "Redis" },
  {
    workload: "SET, persisted",
    setting: "64 clients",
    unit: "ops/s",
    denis: 61800,
    other: 115600,
    otherName: "Redis",
    note: "thread per connection vs event loop",
  },
  { workload: "MGET 10 keys", setting: "16 clients", unit: "relative", denis: 80, other: 100, otherName: "Redis", note: "Denis at ~80 % of Redis" },
];

const fmt = (n: number, unit: string) => (unit === "relative" ? `${n} %` : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));

function Bars({ p }: { p: Pair }) {
  const max = Math.max(p.denis, p.other);
  const W = 420;
  const H = 46;
  const bar = 12;
  const gap = 8;
  const labelW = 74;
  const track = W - labelW - 64;
  const rows: { name: string; value: number; ink: boolean }[] = [
    { name: "Denis", value: p.denis, ink: true },
    { name: p.otherName, value: p.other, ink: false },
  ];
  const wins = p.denis >= p.other;
  return (
    <div className="grid gap-2 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-[14.5px] font-medium">{p.workload}</div>
          <div className="text-[12.5px] text-[var(--l-ash)]">
            {p.setting}
            {p.note ? ` · ${p.note}` : ""}
          </div>
        </div>
        <div className={"shrink-0 font-mono text-[11.5px] " + (wins ? "text-[var(--l-ink)]" : "text-[var(--l-ash)]")}>
          {wins ? `${(p.denis / p.other).toFixed(1)}× Denis` : `${(p.other / p.denis).toFixed(1)}× ${p.otherName}`}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${p.workload}: Denis ${p.denis} ${p.unit}, ${p.otherName} ${p.other} ${p.unit}`}
      >
        {rows.map((r, i) => {
          const y = i * (bar + gap) + 4;
          const w = Math.max(2, (r.value / max) * track);
          return (
            <g key={r.name}>
              <text x={0} y={y + bar - 2} fontSize={11.5} fill="var(--l-ash)">
                {r.name}
              </text>
              <rect x={labelW} y={y} width={track} height={bar} fill="var(--l-line)" opacity={0.35} rx={1} />
              <rect x={labelW} y={y} width={w} height={bar} fill={r.ink ? "var(--l-ink)" : "var(--l-ash)"} rx={1} className="lb-bar" />
              <text x={labelW + w + 8} y={y + bar - 2} fontSize={11.5} fill="var(--l-ink)" fontFamily="var(--font-plex-mono), monospace">
                {fmt(r.value, p.unit)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BenchmarkCharts() {
  return (
    <div className="grid divide-y divide-[var(--l-line)] md:grid-cols-2 md:gap-x-12 md:divide-y-0 md:[&>*]:border-b md:[&>*]:border-[var(--l-line)]">
      {PAIRS.map((p) => (
        <Bars key={p.workload + p.setting} p={p} />
      ))}
    </div>
  );
}

/** Durability, stated as it was measured. */
export function DurabilityFacts() {
  const facts = [
    { label: "Denis, SIGKILL", value: "9,079 / 9,079", note: "acknowledged writes recovered from the journal" },
    { label: "Redis, SIGKILL", value: "9,968 / 9,968", note: "AOF, fsync every second" },
    { label: "Denis, graceful restart", value: "5,000 / 5,000", note: "keys back from database.bin" },
    { label: "Memory, 100k × 100 B keys", value: "212 MB", note: "Redis 26 MB · PostgreSQL 47 MB — the JVM heap plus the persisted copy" },
  ];
  return (
    <dl className="grid divide-y divide-[var(--l-line)] border-y border-[var(--l-line)] sm:grid-cols-2 sm:divide-y-0 sm:[&>*]:border-b sm:[&>*]:border-[var(--l-line)] sm:[&>*:nth-child(even)]:pl-8 sm:[&>*:nth-child(odd)]:border-r sm:[&>*:nth-child(odd)]:pr-8">
      {facts.map((f) => (
        <div key={f.label} className="py-5">
          <dt className="text-[12.5px] text-[var(--l-ash)]">{f.label}</dt>
          <dd className="mt-1 font-mono text-[1.35rem] tracking-[-0.01em] tabular-nums">{f.value}</dd>
          <dd className="mt-1 text-[12.5px] text-[var(--l-ash)]">{f.note}</dd>
        </div>
      ))}
    </dl>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { StatStrip } from "@/components/app/page-primitives";
import { OpsChart, StorageChart } from "@/components/app/usage-chart";
import { getAccess } from "@/lib/access";
import { opsToday, sampleUsage, usageHistory } from "@/lib/databases";
import { formatBytes, formatDate, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const access = await getAccess(user.id, id);
  if (!access) notFound();
  const row = access.database;
  const [database, history, today] = await Promise.all([sampleUsage(row).catch(() => row), usageHistory(row.id, 7), opsToday(row.id)]);
  const points = history.map((h) => ({ ...h, hour: h.hour.toISOString() }));
  const latencyTotal = history.reduce((s, h) => s + h.latencyMs, 0);
  const opsTotal = history.reduce((s, h) => s + h.ops, 0);

  return (
    <>
      <StatStrip
        stats={[
          {
            label: "Storage",
            value: formatBytes(database.persistedBytes),
            progress: percent(database.persistedBytes, database.maxBytes),
            hint: `of ${formatBytes(database.maxBytes)}`,
          },
          {
            label: "Keys",
            value: formatNumber(database.persistedKeys),
            progress: percent(database.persistedKeys, database.maxKeys),
            hint: `of ${formatNumber(database.maxKeys)} · ${formatNumber(database.cachedKeys)} cached`,
          },
          {
            label: "Commands today",
            value: formatNumber(today),
            progress: percent(today, database.opsPerDay),
            hint: `of ${formatNumber(database.opsPerDay)}`,
          },
          {
            label: "Latency, 7 days",
            value: opsTotal ? `${(latencyTotal / opsTotal).toFixed(1)} ms` : "–",
            hint: `average over ${formatNumber(opsTotal)} commands`,
          },
        ]}
      />

      <div className="grid gap-6 @4xl/main:grid-cols-3">
        <div className="@4xl/main:col-span-2">
          <OpsChart points={points} />
        </div>
        <StorageChart points={points} maxBytes={database.maxBytes} />
      </div>

      <nav className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
        <Link
          href={`/databases/${database.id}/console`}
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Open the console
        </Link>
        <Link
          href={`/databases/${database.id}/connect`}
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Create an API key
        </Link>
        <Link
          href={`/databases/${database.id}/connect#mcp`}
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Connect an assistant
        </Link>
        <Link
          href={`/databases/${database.id}/tables`}
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Browse tables
        </Link>
        <a
          href={`/api/v1/databases/${database.id}/backup`}
          download
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Download backup
        </a>
        <span className="ml-auto">
          Created {formatDate(database.createdAt)} · {database.region}
        </span>
      </nav>
    </>
  );
}

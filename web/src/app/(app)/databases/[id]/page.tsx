import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/app/stat-card";
import { OpsChart, StorageChart } from "@/components/app/usage-chart";
import { getOwnedDatabase, opsToday, sampleUsage, usageHistory } from "@/lib/databases";
import { formatBytes, formatDate, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const row = await getOwnedDatabase(user.id, id);
  if (!row) notFound();
  const [database, history, today] = await Promise.all([sampleUsage(row).catch(() => row), usageHistory(row.id, 7), opsToday(row.id)]);
  const points = history.map((h) => ({ ...h, hour: h.hour.toISOString() }));
  const latencyTotal = history.reduce((s, h) => s + h.latencyMs, 0);
  const opsTotal = history.reduce((s, h) => s + h.ops, 0);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <StatCard
          label="Storage"
          value={formatBytes(database.persistedBytes)}
          progress={percent(database.persistedBytes, database.maxBytes)}
          hint={`of ${formatBytes(database.maxBytes)} persisted`}
          badge={`${percent(database.persistedBytes, database.maxBytes)} %`}
        />
        <StatCard
          label="Keys"
          value={formatNumber(database.persistedKeys)}
          progress={percent(database.persistedKeys, database.maxKeys)}
          hint={`of ${formatNumber(database.maxKeys)} · ${formatNumber(database.cachedKeys)} in cache`}
        />
        <StatCard
          label="Commands today"
          value={formatNumber(today)}
          progress={percent(today, database.opsPerDay)}
          hint={`of ${formatNumber(database.opsPerDay)} per day`}
        />
        <StatCard label="Avg latency (7 d)" value={opsTotal ? `${(latencyTotal / opsTotal).toFixed(1)} ms` : "–"} hint={`${formatNumber(opsTotal)} commands`} />
      </div>

      <div className="grid gap-4 @4xl/main:grid-cols-3">
        <div className="@4xl/main:col-span-2">
          <OpsChart points={points} />
        </div>
        <StorageChart points={points} maxBytes={database.maxBytes} />
      </div>

      <div className="grid gap-4 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Everything you can do with this database</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/databases/${database.id}/console`}>Open the console</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/databases/${database.id}/connect`}>Create an API key</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/databases/${database.id}/connect#mcp`}>Connect an AI assistant (MCP)</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/databases/${database.id}/tables`}>Browse tables</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Database id</dt>
              <dd className="font-mono">{database.id}</dd>
              <dt className="text-muted-foreground">Region</dt>
              <dd>{database.region}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatDate(database.createdAt)}</dd>
              <dt className="text-muted-foreground">Limits</dt>
              <dd>
                {formatBytes(database.maxBytes)} · {formatNumber(database.maxKeys)} keys · {formatNumber(database.opsPerDay)} commands/day
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/app/site-header";
import { StatCard } from "@/components/app/stat-card";
import { OpsChart } from "@/components/app/usage-chart";
import { CreateDatabaseDialog } from "@/components/app/create-database-dialog";
import { db, schema } from "@/lib/db";
import { listDatabases, opsToday, sampleUsage, usageHistoryForUser } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber, percent, relativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const limits = plan();
  const rows = await listDatabases(user.id);
  const databases = await Promise.all(rows.map((d) => sampleUsage(d).catch(() => d)));
  const ops = await Promise.all(databases.map((d) => opsToday(d.id)));
  const history = await usageHistoryForUser(user.id, 7);
  const activity = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.userId, user.id))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(8);

  const storage = databases.reduce((s, d) => s + d.persistedBytes, 0);
  const storageMax = limits.dbMaxBytes * Math.max(1, databases.length);
  const opsTotal = ops.reduce((s, n) => s + n, 0);
  const opsMax = limits.dbOpsPerDay * Math.max(1, databases.length);
  const errors = history.reduce((s, h) => s + (h.errors ?? 0), 0);
  const total = history.reduce((s, h) => s + (h.ops ?? 0), 0);

  return (
    <>
      <SiteHeader
        crumbs={[{ label: "Dashboard" }]}
        actions={
          databases.length < limits.maxDatabases ? (
            <CreateDatabaseDialog
              trigger={
                <Button size="sm">
                  <PlusIcon /> New database
                </Button>
              }
            />
          ) : null
        }
      />
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <StatCard
            label="Databases"
            value={`${databases.length} / ${limits.maxDatabases}`}
            progress={percent(databases.length, limits.maxDatabases)}
            hint={databases.length < limits.maxDatabases ? "You can create more" : "Plan limit reached"}
          />
          <StatCard
            label="Storage used"
            value={formatBytes(storage)}
            progress={percent(storage, storageMax)}
            hint={`of ${formatBytes(storageMax)} across your databases`}
          />
          <StatCard label="Commands today" value={formatNumber(opsTotal)} progress={percent(opsTotal, opsMax)} hint={`of ${formatNumber(opsMax)} (resets 00:00 UTC)`} />
          <StatCard
            label="Error rate (7 d)"
            value={total ? `${((errors / total) * 100).toFixed(1)} %` : "0 %"}
            hint={`${formatNumber(errors)} of ${formatNumber(total)} commands failed`}
          />
        </div>

        <OpsChart points={history.map((h) => ({ ...h, hour: h.hour.toISOString() }))} description="All databases, per hour, last 7 days" />

        <div className="grid gap-4 @4xl/main:grid-cols-3">
          <Card className="@4xl/main:col-span-2">
            <CardHeader>
              <CardTitle>Databases</CardTitle>
              <CardDescription>Storage and daily budget per database</CardDescription>
            </CardHeader>
            <CardContent>
              {databases.length === 0 ? (
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <p>No databases yet. Create one to get a console, an API key and an MCP endpoint.</p>
                  <CreateDatabaseDialog trigger={<Button size="sm">Create your first database</Button>} />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Keys</TableHead>
                      <TableHead className="text-right">Storage</TableHead>
                      <TableHead className="text-right">Commands today</TableHead>
                      <TableHead className="text-right">Sampled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {databases.map((d, i) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          <Link href={`/databases/${d.id}`} className="hover:underline">
                            {d.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{d.region}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(d.persistedKeys)} / {formatNumber(d.maxKeys)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBytes(d.persistedBytes)} <span className="text-muted-foreground">({percent(d.persistedBytes, d.maxBytes)} %)</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(ops[i])} / {formatNumber(d.opsPerDay)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{relativeTime(d.usageSampledAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Databases, keys and quota events</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{a.action}</div>
                        {a.detail && <div className="truncate text-muted-foreground">{a.detail}</div>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

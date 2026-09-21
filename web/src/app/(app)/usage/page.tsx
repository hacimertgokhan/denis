import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/app/site-header";
import { OpsChart } from "@/components/app/usage-chart";
import { listDatabases, opsToday, sampleUsage, usageHistory, usageHistoryForUser } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Usage" };

export default async function UsagePage() {
  const user = await requireUser();
  const limits = plan();
  const rows = await listDatabases(user.id);
  const databases = await Promise.all(rows.map((d) => sampleUsage(d).catch(() => d)));
  const [today, histories, total] = await Promise.all([
    Promise.all(databases.map((d) => opsToday(d.id))),
    Promise.all(databases.map((d) => usageHistory(d.id, 30))),
    usageHistoryForUser(user.id, 30),
  ]);
  const monthOps = histories.map((h) => h.reduce((s, x) => s + x.ops, 0));

  return (
    <>
      <SiteHeader crumbs={[{ label: "Usage" }]} />
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <OpsChart points={total.map((h) => ({ ...h, hour: h.hour.toISOString() }))} days={30} title="Commands (30 days)" description="All databases, per hour" />
        <Card>
          <CardHeader>
            <CardTitle>Per database</CardTitle>
            <CardDescription>
              Plan: {limits.maxDatabases} databases · {formatBytes(limits.dbMaxBytes)} and {formatNumber(limits.dbMaxKeys)} keys each · {formatNumber(limits.dbOpsPerDay)}{" "}
              commands per day each
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Database</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Keys</TableHead>
                  <TableHead>Commands today</TableHead>
                  <TableHead className="text-right">Commands (30 d)</TableHead>
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
                    <TableCell className="min-w-40">
                      <div className="mb-1 text-xs tabular-nums">
                        {formatBytes(d.persistedBytes)} / {formatBytes(d.maxBytes)}
                      </div>
                      <Progress value={percent(d.persistedBytes, d.maxBytes)} />
                    </TableCell>
                    <TableCell className="min-w-40">
                      <div className="mb-1 text-xs tabular-nums">
                        {formatNumber(d.persistedKeys)} / {formatNumber(d.maxKeys)}
                      </div>
                      <Progress value={percent(d.persistedKeys, d.maxKeys)} />
                    </TableCell>
                    <TableCell className="min-w-40">
                      <div className="mb-1 text-xs tabular-nums">
                        {formatNumber(today[i])} / {formatNumber(d.opsPerDay)}
                      </div>
                      <Progress value={percent(today[i], d.opsPerDay)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(monthOps[i])}</TableCell>
                  </TableRow>
                ))}
                {databases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No databases yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

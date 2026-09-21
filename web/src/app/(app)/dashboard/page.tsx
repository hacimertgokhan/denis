import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/app/site-header";
import { EmptyState, PageHeader, Panel, StatStrip } from "@/components/app/page-primitives";
import { OpsChart } from "@/components/app/usage-chart";
import { CreateDatabaseDialog } from "@/components/app/create-database-dialog";
import { db, schema } from "@/lib/db";
import { listDatabases, opsToday, sampleUsage, usageHistoryForUser } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber, percent, relativeTime } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Dashboard" };

const ACTIONS: Record<string, string> = {
  "database.create": "Created database",
  "database.delete": "Deleted database",
  "database.reset": "Emptied database",
  "apikey.create": "Created API key",
  "apikey.revoke": "Revoked API key",
  "quota.ops": "Daily command budget reached",
  "quota.storage": "Storage limit reached",
};

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
  const canCreate = databases.length < limits.maxDatabases;

  return (
    <>
      <SiteHeader crumbs={[{ label: "Dashboard" }]} />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 py-5 lg:px-10 lg:py-8">
        <PageHeader
          title={`Good to see you, ${user.name.split(" ")[0]}.`}
          description={databases.length === 0 ? "Create a database to get a console, an API key and an MCP endpoint." : `${databases.length} of ${limits.maxDatabases} databases in use.`}
          actions={
            canCreate ? (
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

        <StatStrip
          stats={[
            { label: "Databases", value: `${databases.length} / ${limits.maxDatabases}`, progress: percent(databases.length, limits.maxDatabases) },
            { label: "Storage used", value: formatBytes(storage), progress: percent(storage, storageMax), hint: `of ${formatBytes(storageMax)}` },
            { label: "Commands today", value: formatNumber(opsTotal), progress: percent(opsTotal, opsMax), hint: `of ${formatNumber(opsMax)}, resets 00:00 UTC` },
            { label: "Failed commands, 7 days", value: total ? `${((errors / total) * 100).toFixed(1)} %` : "0 %", hint: `${formatNumber(errors)} of ${formatNumber(total)}` },
          ]}
        />

        <OpsChart points={history.map((h) => ({ ...h, hour: h.hour.toISOString() }))} description="Every database, per hour, last 7 days" />

        <div className="grid gap-6 @4xl/main:grid-cols-[1fr_20rem]">
          <Panel title="Databases" bodyClassName="p-0">
            {databases.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No databases yet">
                  <CreateDatabaseDialog trigger={<Button size="sm" className="mt-3">Create your first database</Button>} />
                </EmptyState>
              </div>
            ) : (
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b text-left text-[12.5px] text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Name</th>
                    <th className="px-5 py-2 text-right font-medium">Keys</th>
                    <th className="px-5 py-2 text-right font-medium">Storage</th>
                    <th className="px-5 py-2 text-right font-medium">Commands today</th>
                    <th className="px-5 py-2 text-right font-medium">Sampled</th>
                  </tr>
                </thead>
                <tbody>
                  {databases.map((d, i) => (
                    <tr key={d.id} className="border-b last:border-b-0 hover:bg-muted/40">
                      <td className="px-5 py-2.5 font-medium">
                        <Link href={`/databases/${d.id}`} className="hover:underline">
                          {d.name}
                        </Link>
                        <span className="ml-2 text-[12px] font-normal text-muted-foreground">{d.region}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(d.persistedKeys)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatBytes(d.persistedBytes)} <span className="text-muted-foreground">· {percent(d.persistedBytes, d.maxBytes)} %</span>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(ops[i])}</td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground">{relativeTime(d.usageSampledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Activity" bodyClassName="p-0">
            {activity.length === 0 ? (
              <p className="p-5 text-[13.5px] text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3 text-[13.5px]">
                    <div className="min-w-0">
                      <div>{ACTIONS[a.action] ?? a.action}</div>
                      {a.detail && <div className="truncate text-[12.5px] text-muted-foreground">{a.detail}</div>}
                    </div>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{relativeTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

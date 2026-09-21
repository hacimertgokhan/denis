import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { PageHeader, Panel } from "@/components/app/page-primitives";
import { OpsChart } from "@/components/app/usage-chart";
import { listDatabases, opsToday, sampleUsage, usageHistory, usageHistoryForUser } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Usage" };

function Meter({ used, max, format }: { used: number; max: number; format: (n: number) => string }) {
  const p = percent(used, max);
  return (
    <div className="min-w-40">
      <div className="mb-1 flex justify-between text-[12.5px] tabular-nums">
        <span>{format(used)}</span>
        <span className="text-muted-foreground">{p} %</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={p >= 80 ? "h-full bg-destructive" : "h-full bg-[var(--chart-1)]"} style={{ width: `${Math.max(2, p)}%` }} />
      </div>
    </div>
  );
}

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
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 py-5 lg:px-10 lg:py-8">
        <PageHeader
          title="Usage"
          description={`Per database: ${formatBytes(limits.dbMaxBytes)} of storage, ${formatNumber(limits.dbMaxKeys)} keys and ${formatNumber(limits.dbOpsPerDay)} commands a day. Storage and keys are enforced by the engine, the daily budget by the gateway.`}
        />
        <OpsChart points={total.map((h) => ({ ...h, hour: h.hour.toISOString() }))} days={30} title="Commands, 30 days" description="Every database, per hour" />
        <Panel title="Per database" bodyClassName="p-0">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b text-left text-[12.5px] text-muted-foreground">
                <th className="px-5 py-2 font-medium">Database</th>
                <th className="px-5 py-2 font-medium">Storage</th>
                <th className="px-5 py-2 font-medium">Keys</th>
                <th className="px-5 py-2 font-medium">Commands today</th>
                <th className="px-5 py-2 text-right font-medium">Commands, 30 days</th>
              </tr>
            </thead>
            <tbody>
              {databases.map((d, i) => (
                <tr key={d.id} className="border-b last:border-b-0">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/databases/${d.id}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Meter used={d.persistedBytes} max={d.maxBytes} format={formatBytes} />
                  </td>
                  <td className="px-5 py-3">
                    <Meter used={d.persistedKeys} max={d.maxKeys} format={formatNumber} />
                  </td>
                  <td className="px-5 py-3">
                    <Meter used={today[i]} max={d.opsPerDay} format={formatNumber} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatNumber(monthOps[i])}</td>
                </tr>
              ))}
              {databases.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No databases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

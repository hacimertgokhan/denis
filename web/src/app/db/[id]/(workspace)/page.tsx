import Link from "next/link";
import { redirect } from "next/navigation";
import { StatStrip } from "@/components/app/page-primitives";
import { OpsChart } from "@/components/app/usage-chart";
import { currentAccountAccess } from "@/lib/access";
import { opsToday, sampleUsage, usageHistory } from "@/lib/databases";
import { formatBytes, formatNumber, percent } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function WorkspaceOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  const [database, history, today] = await Promise.all([sampleUsage(access.database).catch(() => access.database), usageHistory(id, 7), opsToday(id)]);
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
            hint: `of ${formatNumber(database.maxKeys)}`,
          },
          {
            label: "Commands today",
            value: formatNumber(today),
            progress: percent(today, database.opsPerDay),
            hint: `of ${formatNumber(database.opsPerDay)}`,
          },
          {
            label: "Your role",
            value: access.actor.role,
            hint: access.actor.role === "viewer" ? "read only" : "read and write",
          },
        ]}
      />
      <OpsChart
        points={history.map((h) => ({
          ...h,
          hour: h.hour.toISOString(),
        }))}
      />
      <nav className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
        <Link href={`/db/${id}/console`} className="decoration-border hover:text-foreground underline underline-offset-4">
          Open the console
        </Link>
        <Link href={`/db/${id}/tables`} className="decoration-border hover:text-foreground underline underline-offset-4">
          Browse tables
        </Link>
        <Link href={`/db/${id}/history`} className="decoration-border hover:text-foreground underline underline-offset-4">
          Command history
        </Link>
        <a
          href={`/api/v1/databases/${id}/backup`}
          download
          className="decoration-border hover:text-foreground hover:decoration-foreground underline underline-offset-4"
        >
          Download backup
        </a>
      </nav>
    </>
  );
}

import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/app/site-header";
import { EmptyState, PageHeader } from "@/components/app/page-primitives";
import { CreateDatabaseDialog } from "@/components/app/create-database-dialog";
import { listDatabases, opsToday, sampleUsage } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatDate, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Databases" };

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={value >= 80 ? "h-full bg-destructive" : "h-full bg-[var(--chart-1)]"} style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}

export default async function DatabasesPage() {
  const user = await requireUser();
  const limits = plan();
  const rows = await listDatabases(user.id);
  const databases = await Promise.all(rows.map((d) => sampleUsage(d).catch(() => d)));
  const ops = await Promise.all(databases.map((d) => opsToday(d.id)));
  const canCreate = databases.length < limits.maxDatabases;
  return (
    <>
      <SiteHeader crumbs={[{ label: "Databases" }]} />
      <div className="mx-auto w-full max-w-[1120px] flex-1 p-5 lg:p-8">
        <PageHeader
          title="Databases"
          description={`${databases.length} of ${limits.maxDatabases} on the free plan. Each one has ${formatBytes(limits.dbMaxBytes)}, ${formatNumber(limits.dbMaxKeys)} keys and ${formatNumber(limits.dbOpsPerDay)} commands a day.`}
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
        <div className="mt-6">
          {databases.length === 0 ? (
            <EmptyState title="No databases yet">
              <CreateDatabaseDialog trigger={<Button size="sm" className="mt-3">Create your first database</Button>} />
            </EmptyState>
          ) : (
            <ul className="divide-y border-y">
              {databases.map((d, i) => (
                <li key={d.id} className="grid gap-4 py-5 md:grid-cols-[minmax(0,16rem)_1fr_1fr_1fr] md:items-center md:gap-8">
                  <div>
                    <Link href={`/databases/${d.id}`} className="text-[16px] font-medium hover:underline">
                      {d.name}
                    </Link>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {d.region} · created {formatDate(d.createdAt)}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">Storage</span>
                      <span className="tabular-nums">
                        {formatBytes(d.persistedBytes)} / {formatBytes(d.maxBytes)}
                      </span>
                    </div>
                    <Bar value={percent(d.persistedBytes, d.maxBytes)} />
                  </div>
                  <div>
                    <div className="mb-1.5 flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">Keys</span>
                      <span className="tabular-nums">
                        {formatNumber(d.persistedKeys)} / {formatNumber(d.maxKeys)}
                      </span>
                    </div>
                    <Bar value={percent(d.persistedKeys, d.maxKeys)} />
                  </div>
                  <div>
                    <div className="mb-1.5 flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">Commands today</span>
                      <span className="tabular-nums">
                        {formatNumber(ops[i])} / {formatNumber(d.opsPerDay)}
                      </span>
                    </div>
                    <Bar value={percent(ops[i], d.opsPerDay)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

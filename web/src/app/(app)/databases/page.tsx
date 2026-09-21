import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SiteHeader } from "@/components/app/site-header";
import { CreateDatabaseDialog } from "@/components/app/create-database-dialog";
import { listDatabases, sampleUsage } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatDate, formatNumber, percent } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Databases" };

export default async function DatabasesPage() {
  const user = await requireUser();
  const limits = plan();
  const rows = await listDatabases(user.id);
  const databases = await Promise.all(rows.map((d) => sampleUsage(d).catch(() => d)));
  return (
    <>
      <SiteHeader
        crumbs={[{ label: "Databases" }]}
        actions={
          databases.length < limits.maxDatabases ? (
            <CreateDatabaseDialog
              trigger={
                <Button size="sm">
                  <PlusIcon /> New database
                </Button>
              }
            />
          ) : (
            <Badge variant="outline">{limits.maxDatabases} of {limits.maxDatabases} used</Badge>
          )
        }
      />
      <div className="grid gap-4 p-4 lg:p-6 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        {databases.map((d) => (
          <Card key={d.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="truncate">{d.name}</span>
                <Badge variant="secondary">{d.region}</Badge>
              </CardTitle>
              <CardDescription>Created {formatDate(d.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="tabular-nums">
                    {formatBytes(d.persistedBytes)} / {formatBytes(d.maxBytes)}
                  </span>
                </div>
                <Progress value={percent(d.persistedBytes, d.maxBytes)} />
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-muted-foreground">Keys</span>
                  <span className="tabular-nums">
                    {formatNumber(d.persistedKeys)} / {formatNumber(d.maxKeys)}
                  </span>
                </div>
                <Progress value={percent(d.persistedKeys, d.maxKeys)} />
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href={`/databases/${d.id}`}>
                  Open <ArrowRightIcon />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
        {databases.length === 0 && (
          <Card className="col-span-full border-dashed">
            <CardHeader>
              <CardTitle>No databases yet</CardTitle>
              <CardDescription>
                Your plan includes {limits.maxDatabases} databases with {formatBytes(limits.dbMaxBytes)} and {formatNumber(limits.dbMaxKeys)} keys each.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <CreateDatabaseDialog trigger={<Button>Create a database</Button>} />
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/app/site-header";
import { ProfileForm } from "@/components/app/profile-form";
import { countDatabases } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const limits = plan();
  const used = await countDatabases(user.id);
  return (
    <>
      <SiteHeader crumbs={[{ label: "Settings" }]} />
      <div className="grid gap-4 p-4 lg:p-6 @4xl/main:grid-cols-2">
        <ProfileForm user={{ name: user.name, email: user.email }} />
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>Free tier — every account gets the same limits.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Databases</dt>
              <dd>
                {used} of {limits.maxDatabases}
              </dd>
              <dt className="text-muted-foreground">Storage per database</dt>
              <dd>{formatBytes(limits.dbMaxBytes)}</dd>
              <dt className="text-muted-foreground">Keys per database</dt>
              <dd>{formatNumber(limits.dbMaxKeys)}</dd>
              <dt className="text-muted-foreground">Commands per day</dt>
              <dd>{formatNumber(limits.dbOpsPerDay)} per database</dd>
              <dt className="text-muted-foreground">API rate limit</dt>
              <dd>{formatNumber(limits.apiRatePerMinute)} requests / minute per key</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

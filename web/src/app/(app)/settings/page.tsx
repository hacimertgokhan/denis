import { SiteHeader } from "@/components/app/site-header";
import { PageHeader, SectionRow } from "@/components/app/page-primitives";
import { ProfileForm } from "@/components/app/profile-form";
import { SignOutButton } from "@/components/app/sign-out-button";
import { countDatabases } from "@/lib/databases";
import { plan } from "@/lib/env";
import { formatBytes, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const limits = plan();
  const used = await countDatabases(user.id);
  const rows: [string, string][] = [
    ["Databases", `${used} of ${limits.maxDatabases}`],
    ["Storage per database", formatBytes(limits.dbMaxBytes)],
    ["Keys per database", formatNumber(limits.dbMaxKeys)],
    ["Commands per day", `${formatNumber(limits.dbOpsPerDay)} per database`],
    ["API requests", `${formatNumber(limits.apiRatePerMinute)} per minute per key`],
  ];
  return (
    <>
      <SiteHeader crumbs={[{ label: "Settings" }]} />
      <div className="w-full flex-1 px-5 py-5 lg:px-8 lg:py-8">
        <PageHeader title="Settings" description="Your account and the limits of the free plan." />
        <div className="mt-4">
          <ProfileForm user={{ name: user.name, email: user.email }} />
          <SectionRow title="Plan" description="Every account is on the free plan. Limits are enforced by the engine and the gateway.">
            <dl className="max-w-md divide-y rounded-lg border text-[14px]">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-6 px-4 py-2.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </SectionRow>
          <SectionRow title="Session" description="Sign out of this browser.">
            <SignOutButton />
          </SectionRow>
        </div>
      </div>
    </>
  );
}

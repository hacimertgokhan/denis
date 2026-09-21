import { AdminActivity } from "@/components/app/admin-activity";
import { PageHeader, StatStrip } from "@/components/app/page-primitives";
import { adminAuditLog, adminRecentCommands, adminStats, engineInfo, engineProjects } from "@/lib/admin";
import { formatBytes, formatNumber } from "@/lib/format";

export const metadata = { title: "Administration" };

export default async function AdminOverview() {
  const [stats, engine, projects, audit, commands] = await Promise.all([
    adminStats(),
    engineInfo(),
    engineProjects(),
    adminAuditLog({ limit: 10 }),
    adminRecentCommands({ limit: 10 }),
  ]);
  const orphaned = projects === null ? 0 : Math.max(0, projects.length - stats.databases);
  return (
    <>
      <PageHeader title="Platform" description="Everything the platform holds, and what the engine says it holds." />
      <StatStrip
        stats={[
          { label: "Users", value: formatNumber(stats.users), hint: `${stats.signups24h} joined in 24 h · ${stats.suspended} suspended` },
          { label: "Databases", value: formatNumber(stats.databases), hint: `${formatBytes(stats.storedBytes)} · ${formatNumber(stats.storedKeys)} keys` },
          { label: "Commands, 24 h", value: formatNumber(stats.commands24h), hint: `${formatNumber(stats.failed24h)} failed` },
          {
            label: "Credentials",
            value: formatNumber(stats.activeKeys + stats.accounts),
            hint: `${stats.activeKeys} API keys · ${stats.accounts} accounts · ${stats.members} members`,
          },
        ]}
      />
      <section className="bg-card overflow-hidden rounded-lg border">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-[14px] font-medium">Engine</h2>
          <span className="text-muted-foreground text-[12.5px]">{engine ? `Denis ${engine.version}` : "unreachable"}</span>
        </header>
        {engine ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-[13.5px] sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Uptime", `${Math.floor(engine.uptimeSeconds / 3600)} h ${Math.floor((engine.uptimeSeconds % 3600) / 60)} min`],
              ["Connections", `${engine.connections.open} open · ${formatNumber(engine.connections.total)} total`],
              ["Commands served", formatNumber(engine.commandsTotal)],
              ["Keys in memory", formatNumber(engine.cacheKeys)],
              ["Keys on disk", `${formatNumber(engine.persistedKeys)}${engine.persistedDirty ? " (dirty)" : ""}`],
              ["Projects", `${engine.projects}${orphaned ? ` · ${orphaned} not in the platform` : ""}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground text-[12.5px]">{k}</dt>
                <dd className="mt-0.5 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground px-5 py-6 text-[13.5px]">The engine did not answer. Check DENIS_HOST, DENIS_PORT and the main token.</p>
        )}
      </section>
      <AdminActivity
        audit={audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
        commands={commands.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
        compact
      />
    </>
  );
}

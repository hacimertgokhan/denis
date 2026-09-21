import Link from "next/link";
import { LandingNav } from "@/components/landing/nav";
import { LandingFooter } from "@/components/landing/footer";
import { ConsoleDemo } from "@/components/landing/console-demo";
import { HeroAtmosphere } from "@/components/landing/atmosphere";
import { CodeBlock } from "@/components/app/code-block";
import { ArchitectureDiagram, DurabilityDiagram, McpFlowDiagram } from "@/components/app/diagrams";
import { currentUser } from "@/lib/session";
import { env, plan } from "@/lib/env";
import { formatBytes, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "0.5.0";

export default async function Landing() {
  const user = await currentUser();
  const limits = plan();
  const base = env().NEXT_PUBLIC_APP_URL;

  const capabilities: { name: string; what: string; how: string }[] = [
    { name: "Keys", what: "Strings, or JSON when you need structure. In memory, journaled to disk when you ask.", how: "GET · SET · DEL · MGET · KEYS · EXISTS" },
    { name: "Tables", what: "A small SQL: one table per statement, an index on every column, rows kept in memory.", how: "CREATE TABLE · INSERT · SELECT with WHERE, ORDER BY, LIMIT · UPDATE · DELETE" },
    { name: "Assistants", what: "A hosted MCP endpoint per database. Read-only keys expose only the read tools.", how: "denis_describe · denis_query · denis_execute · denis_get · denis_set" },
    { name: "Console", what: "Run commands, browse tables and keys, watch storage and daily commands on charts.", how: "Web console · REST API · JWT for apps" },
  ];

  return (
    <div className="landing min-h-screen font-sans text-[var(--l-ink)]">
      <LandingNav signedIn={Boolean(user)} />

      <main>
        {/* hero: a sentence and the thing itself */}
        <section className="relative">
          <HeroAtmosphere />
          <div className="mx-auto grid max-w-[1400px] gap-12 px-6 lg:px-10 pt-32 pb-20 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-center lg:gap-16 lg:pt-40">
          <div>
            <h1 className="text-[2.5rem] leading-[1.05] font-medium tracking-[-0.02em] text-balance sm:text-[3.25rem]">
              A database you talk to one line at a time.
            </h1>
            <p className="mt-6 max-w-[38ch] text-[17px] leading-[1.55] text-[var(--l-ash)]">
              Denis keeps keys and small tables in memory and writes every change to a journal. Your app speaks to it over a line protocol; your AI
              assistant speaks to it over MCP.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href={user ? "/dashboard" : "/register"}
                className="rounded-md bg-[var(--l-ink)] px-5 py-2.5 text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
              >
                Create a database
              </Link>
              <a
                href="https://github.com/hacimertgokhan/denis/blob/master/docs/PROTOCOL.md"
                target="_blank"
                rel="noreferrer"
                className="text-[15px] text-[var(--l-ash)] underline decoration-[var(--l-line)] underline-offset-4 transition-colors duration-300 hover:text-[var(--l-ink)] hover:decoration-[var(--l-ink)]"
              >
                Read the protocol
              </a>
            </div>
            <p className="mt-10 text-[13.5px] leading-relaxed text-[var(--l-ash)]">
              Free: {limits.maxDatabases} databases per account, {formatBytes(limits.dbMaxBytes)} and {formatNumber(limits.dbMaxKeys)} keys each,{" "}
              {formatNumber(limits.dbOpsPerDay)} commands a day.
            </p>
          </div>
          <ConsoleDemo />
          </div>
        </section>

        {/* what you get: a table, not cards */}
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-16">
          <h2 className="text-[13px] font-medium text-[var(--l-ash)]">What a database gives you</h2>
          <dl className="mt-4 divide-y divide-[var(--l-line)] border-y border-[var(--l-line)]">
            {capabilities.map((c) => (
              <div key={c.name} className="grid gap-2 py-5 md:grid-cols-[10rem_1fr_minmax(0,22rem)] md:gap-8">
                <dt className="text-[17px] font-medium">{c.name}</dt>
                <dd className="max-w-[52ch] text-[15px] leading-[1.55] text-[var(--l-ash)]">{c.what}</dd>
                <dd className="font-mono text-[12.5px] leading-[1.7] text-[var(--l-ash)] md:text-right">{c.how}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* architecture */}
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
            <div>
              <h2 className="text-[1.5rem] leading-tight font-medium tracking-[-0.01em]">Your data has one door.</h2>
              <p className="mt-4 max-w-[38ch] text-[15px] leading-[1.55] text-[var(--l-ash)]">
                The console, the REST API and the MCP endpoint all pass through the same gateway. It checks who owns the database, whether the key may
                write, and how much of today&apos;s budget is left, then hands the command to the engine. Each database is a separate project inside
                the engine; nothing else can reach it.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--l-line)] bg-[var(--card)] p-4">
              <ArchitectureDiagram />
            </div>
          </div>
        </section>

        {/* assistants */}
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
            <div>
              <h2 className="text-[1.5rem] leading-tight font-medium tracking-[-0.01em]">Let an assistant look at it.</h2>
              <p className="mt-4 max-w-[38ch] text-[15px] leading-[1.55] text-[var(--l-ash)]">
                Add the endpoint to Claude Desktop, Claude Code or Cursor with an API key. The assistant reads the schema first, then writes and runs
                the query. Give it a read-only key and it can only read.
              </p>
            </div>
            <div className="grid gap-4">
              <CodeBlock
                title="MCP configuration"
                code={`{
  "mcpServers": {
    "denis": {
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer dk_your_api_key" }
    }
  }
}`}
              />
              <div className="rounded-xl border border-[var(--l-line)] bg-[var(--card)] p-4">
                <McpFlowDiagram />
              </div>
            </div>
          </div>
        </section>

        {/* durability */}
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-16 pb-24">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
            <div>
              <h2 className="text-[1.5rem] leading-tight font-medium tracking-[-0.01em]">Fast because it is in memory. Safe because it is written down.</h2>
              <p className="mt-4 max-w-[38ch] text-[15px] leading-[1.55] text-[var(--l-ash)]">
                A persisted write is acknowledged from memory and appended to a journal in the same moment. A snapshot replaces the journal every
                thirty seconds. If the process is killed, nothing is lost; if the power goes, at most one second is.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--l-line)] bg-[var(--card)] p-4">
              <DurabilityDiagram />
            </div>
          </div>
        </section>
      </main>

      <LandingFooter version={ENGINE_VERSION} />
    </div>
  );
}

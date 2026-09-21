import type { Metadata } from "next";
import Link from "next/link";
import { LandingNav } from "@/components/landing/nav";
import { LandingFooter } from "@/components/landing/footer";
import { ConsoleDemo } from "@/components/landing/console-demo";
import { HeroAtmosphere } from "@/components/landing/atmosphere";
import { BenchmarkCharts, DurabilityFacts } from "@/components/landing/benchmarks";
import { Cross, Frame, Section } from "@/components/landing/frame";
import { HeroSignal } from "@/components/landing/hero-signal";
import { CodeBlock } from "@/components/app/code-block";
import { ArchitectureDiagram, DurabilityDiagram, McpFlowDiagram } from "@/components/app/diagrams";
import { currentUser } from "@/lib/session";
import { env, plan } from "@/lib/env";
import { formatBytes, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "0.6.0";
const REPO = "https://github.com/hacimertgokhan/denis";

export const metadata: Metadata = {
  title: "Denis Cloud — a hosted key-value and SQL database with an MCP endpoint",
  description:
    "Denis keeps keys and small tables in memory and journals every write to disk. Get a database in seconds with a web console, a REST API, a Node.js client and a hosted MCP endpoint for AI assistants. Free plan, open-source engine.",
  alternates: { canonical: "/" },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Denis?",
    a: "An open-source, MIT-licensed database engine written in Java. It keeps keys and small SQL tables in memory, appends every write to a journal and snapshots to disk, and speaks a one-line-per-command protocol over TCP. Denis Cloud hosts it for you.",
  },
  {
    q: "Is it a Redis or a PostgreSQL replacement?",
    a: "Neither, and both a little. Key-value latency matches Redis at ~0.3 ms; SQL point reads and writes by id are faster than PostgreSQL because rows live in memory with an index per column; range scans and heavy analytics belong in PostgreSQL. It is built for the working set of an application, not for a warehouse.",
  },
  {
    q: "How do AI assistants use it?",
    a: "Every database has a hosted MCP endpoint. Add it to Claude Desktop, Claude Code or Cursor with an API key and the assistant gets denis_describe, denis_query and friends: it reads the schema, writes the SQL and runs it. A read-only key exposes only the read tools.",
  },
  {
    q: "What does the free plan include?",
    a: "Three databases per account, each with 10 MB of storage, 50,000 keys and 100,000 commands a day, plus 600 API requests per minute per key. The limits are enforced by the engine and the gateway, never silently.",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. The engine ships as a jar and a Docker image; the same Node.js package speaks TCP to your own server (DenisClient) or HTTPS to the cloud (DenisCloud) with identical method names. The whole platform is open source too.",
  },
  {
    q: "Where is my data and who can see it?",
    a: "In the region shown on the database (eu-central), isolated as a separate project inside the engine. Only accounts you share with, database accounts you create and API keys you issue can reach it. The Privacy Policy lists everything the platform stores and for how long; you can export or delete it at any time.",
  },
];

export default async function Landing() {
  const user = await currentUser();
  const limits = plan();
  const base = env().NEXT_PUBLIC_APP_URL;

  const capabilities: { name: string; what: string; how: string }[] = [
    {
      name: "Keys",
      what: "Strings, or JSON when you need structure. In memory, journaled to disk when you ask.",
      how: "GET · SET · DEL · MGET · KEYS · EXISTS",
    },
    {
      name: "Tables",
      what: "A small SQL: one table per statement, an index on every column, rows kept in memory.",
      how: "CREATE TABLE · INSERT · SELECT with WHERE, ORDER BY, LIMIT · UPDATE · DELETE",
    },
    {
      name: "Assistants",
      what: "A hosted MCP endpoint per database. Read-only keys expose only the read tools.",
      how: "denis_describe · denis_query · denis_execute · denis_get · denis_set",
    },
    {
      name: "Console",
      what: "Run commands, browse tables and keys, watch storage and daily commands on charts.",
      how: "Web console · REST API · JWT for apps",
    },
    {
      name: "Your code",
      what: "npm install denis-client: the same get/set/query API over HTTPS with an API key, or over TCP against your own server.",
      how: "DenisCloud · DenisClient · Java driver",
    },
    {
      name: "Your team",
      what: "Share a database as admin, editor or viewer; give systems their own username at the database's login page; every command is recorded with who ran it.",
      how: "Roles · database accounts · command history",
    },
  ];

  const numbers: { value: string; label: string; note: string }[] = [
    { value: "0.3 ms", label: "key-value p50", note: "same as Redis, single client" },
    { value: "20k/s", label: "SQL point reads", note: "16 clients, 10k rows; PostgreSQL 17k" },
    { value: "100 %", label: "writes survive SIGKILL", note: "9,079 of 9,079 acknowledged" },
    { value: "≤ 1 s", label: "journal fsync", note: "snapshot every 30 s" },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Denis Cloud",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        url: base,
        description: metadata.description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: `${limits.maxDatabases} databases, ${formatBytes(limits.dbMaxBytes)} each` },
        softwareVersion: ENGINE_VERSION,
        license: `${REPO}/blob/master/LICENSE`,
        sameAs: [REPO],
        author: { "@type": "Person", name: "Hacı Mert Gökhan", url: "https://hacimertgokhan.com", email: "hacimertgokhan@gmail.com" },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <div className="landing min-h-screen font-sans text-[var(--l-ink)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <LandingNav signedIn={Boolean(user)} />

      <Frame>
        <main>
          {/* hero: a sentence, the thing itself, and the two ways in */}
          <Section rule className="overflow-hidden">
            <HeroAtmosphere />
            <div className="lf-sweep" aria-hidden />
            <div className="grid gap-12 pt-32 pb-16 lg:grid-cols-[minmax(0,38rem)_1fr] lg:items-center lg:gap-16 lg:pt-40 lg:pb-24">
              <div>
                <p className="font-mono text-[12px] tracking-[0.16em] text-[var(--l-ash)] uppercase">Open-source engine · hosted for free</p>
                <h1 className="mt-5 text-[2.6rem] leading-[1.02] font-medium tracking-[-0.025em] text-balance sm:text-[3.6rem] lg:text-[4rem]">
                  A database you talk to one line at a time.
                </h1>
                <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.55] text-[var(--l-ash)]">
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
                    href={`${REPO}/blob/master/docs/PROTOCOL.md`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[15px] text-[var(--l-ash)] underline decoration-[var(--l-line)] underline-offset-4 transition-colors duration-300 hover:text-[var(--l-ink)] hover:decoration-[var(--l-ink)]"
                  >
                    Read the protocol
                  </a>
                </div>
                <div className="mt-10 inline-flex max-w-full items-center gap-3 rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 py-2 font-mono text-[13px]">
                  <span className="text-[var(--l-ash)]">$</span>
                  <span className="truncate">npm install denis-client</span>
                </div>
                <p className="mt-6 text-[13.5px] leading-relaxed text-[var(--l-ash)]">
                  Free: {limits.maxDatabases} databases per account, {formatBytes(limits.dbMaxBytes)} and {formatNumber(limits.dbMaxKeys)} keys each,{" "}
                  {formatNumber(limits.dbOpsPerDay)} commands a day. No card, no tracking.
                </p>
              </div>
              <div className="grid gap-3">
                <div className="hidden lg:block">
                  <HeroSignal />
                </div>
                <ConsoleDemo />
              </div>
            </div>
          </Section>

          {/* numbers, measured */}
          <Section rule inner="px-0 lg:px-0">
            <dl className="grid divide-y divide-[var(--l-line)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*]:border-[var(--l-line)] lg:[&>*:not(:first-child)]:border-l sm:[&>*:nth-child(2n)]:border-l">
              {numbers.map((n) => (
                <div key={n.label} className="px-6 py-7 lg:px-10">
                  <dd className="text-[2rem] leading-none font-medium tracking-[-0.02em] tabular-nums">{n.value}</dd>
                  <dt className="mt-2 text-[14px]">{n.label}</dt>
                  <p className="mt-1 text-[12.5px] text-[var(--l-ash)]">{n.note}</p>
                </div>
              ))}
            </dl>
            <p className="border-t border-[var(--l-line)] px-6 py-2.5 text-[12px] text-[var(--l-ash)] lg:px-10">
              Measured against Redis 7 and PostgreSQL 16 on the same machine;{" "}
              <a href={`${REPO}/blob/master/docs/BENCHMARKS.md`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                every number and how to reproduce it
              </a>
              .
            </p>
          </Section>

          {/* benchmarks, wins and losses */}
          <Section rule id="benchmarks">
            <div className="grid gap-8 py-16 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-20 lg:py-24">
              <div>
                <h2 className="text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em]">Measured, not promised.</h2>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  The same machine, the same client, Redis 7 and PostgreSQL 16 in Docker next to Denis {ENGINE_VERSION}. Point reads, writes by id and{" "}
                  <code className="font-mono text-[13.5px]">COUNT(*)</code> are where in-memory rows with an index per column pay off; ordered range scans and
                  raw throughput at 64 connections are where a C event loop and a real query planner still win. Both sides are on the chart.
                </p>
                <a
                  href={`${REPO}/blob/master/docs/BENCHMARKS.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-block text-[14px] underline decoration-[var(--l-line)] underline-offset-4 hover:decoration-[var(--l-ink)]"
                >
                  Full results and how to reproduce them
                </a>
                <div className="mt-10">
                  <h3 className="text-[13px] font-medium tracking-[0.08em] text-[var(--l-ash)] uppercase">Durability and memory</h3>
                  <div className="mt-3">
                    <DurabilityFacts />
                  </div>
                </div>
              </div>
              <BenchmarkCharts />
            </div>
          </Section>

          {/* what you get: a table, not cards */}
          <Section rule>
            <div className="py-16 lg:py-20">
              <h2 className="text-[13px] font-medium tracking-[0.08em] text-[var(--l-ash)] uppercase">What a database gives you</h2>
              <dl className="mt-5 divide-y divide-[var(--l-line)] border-y border-[var(--l-line)]">
                {capabilities.map((c) => (
                  <div key={c.name} className="grid gap-2 py-5 md:grid-cols-[12rem_1fr_minmax(0,26rem)] md:gap-8">
                    <dt className="text-[17px] font-medium">{c.name}</dt>
                    <dd className="max-w-[80ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">{c.what}</dd>
                    <dd className="font-mono text-[12.5px] leading-[1.7] text-[var(--l-ash)] md:text-right">{c.how}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Cross className="left-[calc(max(0px,(100%-1560px)/2)-4px)]" />
          </Section>

          {/* architecture */}
          <Section rule>
            <div className="grid gap-8 py-16 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-20 lg:py-24">
              <div>
                <h2 className="text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em]">Your data has one door.</h2>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  The console, the REST API and the MCP endpoint all pass through the same gateway. It checks who you are, what your role allows, whether the
                  key may write, and how much of today&apos;s budget is left, then hands the command to the engine. Each database is a separate project inside
                  the engine; nothing else can reach it.
                </p>
                <Link
                  href="/security"
                  className="mt-5 inline-block text-[14px] underline decoration-[var(--l-line)] underline-offset-4 hover:decoration-[var(--l-ink)]"
                >
                  How the service is secured
                </Link>
              </div>
              <div className="rounded-xl border border-[var(--l-line)] bg-[var(--card)] p-4">
                <ArchitectureDiagram />
              </div>
            </div>
          </Section>

          {/* assistants */}
          <Section rule>
            <div className="grid gap-8 py-16 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-20 lg:py-24">
              <div>
                <h2 className="text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em]">Let an assistant look at it.</h2>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  Add the endpoint to Claude Desktop, Claude Code or Cursor with an API key. The assistant reads the schema first, then writes and runs the
                  query. Give it a read-only key and it can only read.
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
          </Section>

          {/* durability */}
          <Section rule>
            <div className="grid gap-8 py-16 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-20 lg:py-24">
              <div>
                <h2 className="text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em]">Fast because it is in memory. Safe because it is written down.</h2>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  A persisted write is acknowledged from memory and appended to a journal in the same moment. A snapshot replaces the journal every thirty
                  seconds. If the process is killed, nothing is lost; if the power goes, at most one second is.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--l-line)] bg-[var(--card)] p-4">
                <DurabilityDiagram />
              </div>
            </div>
          </Section>

          {/* two ways to run it */}
          <Section rule inner="px-0 lg:px-0">
            <div className="grid divide-y divide-[var(--l-line)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="px-6 py-14 lg:px-10 lg:py-16">
                <p className="font-mono text-[12px] tracking-[0.16em] text-[var(--l-ash)] uppercase">Hosted</p>
                <h2 className="mt-3 text-[1.4rem] leading-tight font-medium tracking-[-0.015em]">Denis Cloud</h2>
                <p className="mt-3 max-w-[64ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  Sign up, create a database, copy an API key. Console, history, roles, MCP and the REST gateway are ready; quotas keep every tenant in its
                  lane.
                </p>
                <CodeBlock
                  className="mt-6"
                  language="typescript"
                  code={`import { DenisCloud } from "denis-client";

const denis = new DenisCloud({ apiKey: process.env.DENIS_API_KEY });
await denis.set("user:1", { name: "Ada" }, { persist: true });
await denis.query("SELECT * FROM products WHERE price > 10");`}
                />
              </div>
              <div className="px-6 py-14 lg:px-10 lg:py-16">
                <p className="font-mono text-[12px] tracking-[0.16em] text-[var(--l-ash)] uppercase">Self-hosted</p>
                <h2 className="mt-3 text-[1.4rem] leading-tight font-medium tracking-[-0.015em]">Your own server</h2>
                <p className="mt-3 max-w-[64ch] text-[15.5px] leading-[1.6] text-[var(--l-ash)]">
                  One jar or one container, a TCP port, and the same client with the same method names. MIT licensed; the platform you are looking at is open
                  source too.
                </p>
                <CodeBlock
                  className="mt-6"
                  language="bash"
                  code={`docker run -p 5142:5142 ghcr.io/hacimertgokhan/denis:${ENGINE_VERSION}

# then, in your app
const denis = new DenisClient({ host, port: 5142, group, password, token });`}
                />
              </div>
            </div>
          </Section>

          {/* questions */}
          <Section rule>
            <div className="grid gap-8 py-16 lg:grid-cols-[minmax(0,32rem)_1fr] lg:gap-20 lg:py-24">
              <h2 className="text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em]">Questions people ask first.</h2>
              <dl className="divide-y divide-[var(--l-line)] border-y border-[var(--l-line)]">
                {FAQ.map((f) => (
                  <div key={f.q} className="grid gap-2 py-5 md:grid-cols-[minmax(0,22rem)_1fr] md:gap-8">
                    <dt className="text-[15.5px] font-medium">{f.q}</dt>
                    <dd className="text-[15.5px] leading-[1.65] text-[var(--l-ash)]">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Section>

          {/* last word */}
          <Section rule={false}>
            <div className="flex flex-col items-start gap-10 py-24 lg:flex-row lg:items-start lg:justify-between lg:py-32">
              <div>
                <h2 className="text-[2.4rem] leading-[1.02] font-medium tracking-[-0.025em] sm:text-[3.2rem]">Start with one line.</h2>
                <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.55] text-[var(--l-ash)]">
                  A database, a key and an MCP endpoint in under a minute. Delete it all with one click when you are done.
                </p>
              </div>
              <div className="w-full max-w-[30rem] lg:w-[30rem]">
                <ol className="divide-y divide-[var(--l-line)] rounded-xl border border-[var(--l-line)] bg-[var(--card)]">
                  {[
                    ["01", "Create a database", "a name, a region, done"],
                    ["02", "Copy an API key", "read-only or read-write"],
                    ["03", "Connect", "npm install denis-client, or paste the MCP URL"],
                  ].map(([n, title, sub]) => (
                    <li key={n} className="grid grid-cols-[3rem_1fr] items-center gap-3 px-5 py-3.5">
                      <span className="font-mono text-[12px] text-[var(--l-ash)]">{n}</span>
                      <span>
                        <span className="block text-[14.5px] font-medium">{title}</span>
                        <span className="block text-[12.5px] text-[var(--l-ash)]">{sub}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <Link
                    href={user ? "/dashboard" : "/register"}
                    className="rounded-md bg-[var(--l-ink)] px-5 py-2.5 text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90"
                  >
                    {user ? "Open the dashboard" : "Create a free account"}
                  </Link>
                  <a
                    href={REPO}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[15px] underline decoration-[var(--l-line)] underline-offset-4 hover:decoration-[var(--l-ink)]"
                  >
                    Star it on GitHub
                  </a>
                </div>
              </div>
            </div>
          </Section>
        </main>
      </Frame>

      <LandingFooter version={ENGINE_VERSION} />
    </div>
  );
}

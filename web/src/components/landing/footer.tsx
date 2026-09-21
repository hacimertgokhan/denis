import Link from "next/link";
import { GitHubIcon } from "@/components/app/brand-icons";
import { ServiceStatus } from "@/components/landing/status";

const REPO = "https://github.com/hacimertgokhan/denis";

const groups: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Create a database", href: "/register" },
      { label: "Sign in", href: "/login" },
      { label: "Service status", href: "/api/health" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Protocol reference", href: `${REPO}/blob/master/docs/PROTOCOL.md` },
      { label: "Node.js client", href: `${REPO}/tree/master/clients/node` },
      { label: "MCP server", href: `${REPO}/tree/master/clients/mcp` },
      { label: "Java driver", href: `${REPO}/tree/master/java-driver` },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: REPO },
      { label: "Benchmarks", href: `${REPO}/blob/master/docs/BENCHMARKS.md` },
      { label: "Changelog", href: `${REPO}/blob/master/CHANGELOG.md` },
      { label: "MIT license", href: `${REPO}/blob/master/LICENSE` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

/**
 * The footer continues the ruled frame: the column rails run through it,
 * link groups sit in cells, and a bottom bar carries the fine print.
 */
export function LandingFooter({ version }: { version: string }) {
  return (
    <footer className="relative border-t border-[var(--l-line)]">
      <div className="mx-auto max-w-[1560px] border-x border-[var(--l-line)]">
        <div className="grid divide-y divide-[var(--l-line)] lg:grid-cols-[1.6fr_repeat(4,1fr)] lg:divide-x lg:divide-y-0">
          <div className="px-6 py-10 lg:px-10 lg:py-12">
            <p className="text-[1.6rem] leading-none font-medium tracking-[-0.02em]">Denis</p>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed text-[var(--l-ash)]">
              An open-source engine for keys and small tables: in memory, journaled to disk, spoken to one line at a time. Hosted here for free.
            </p>
            <div className="mt-6 flex items-center gap-3 text-[13px] text-[var(--l-ash)]">
              <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--l-ink)]">
                <GitHubIcon className="size-4" /> hacimertgokhan/denis
              </a>
              <span aria-hidden>·</span>
              <span className="font-mono text-[12px]">engine {version}</span>
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.title} className="px-6 py-8 lg:px-8 lg:py-12">
              <p className="text-[12px] font-medium tracking-[0.08em] text-[var(--l-ash)] uppercase">{g.title}</p>
              <ul className="mt-4 grid gap-2.5">
                {g.links.map((l) =>
                  l.href.startsWith("http") ? (
                    <li key={l.label}>
                      <a href={l.href} target="_blank" rel="noreferrer" className="text-[14px] transition-colors duration-300 hover:text-[var(--l-ash)]">
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <Link href={l.href} className="text-[14px] transition-colors duration-300 hover:text-[var(--l-ash)]">
                        {l.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--l-line)] px-6 py-4 text-[12.5px] text-[var(--l-ash)] lg:px-10">
          <span>© {new Date().getFullYear()} Denis Database · MIT licensed · No cookies beyond the session, no trackers.</span>
          <ServiceStatus />
        </div>
      </div>
    </footer>
  );
}

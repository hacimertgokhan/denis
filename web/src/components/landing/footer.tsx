const REPO = "https://github.com/hacimertgokhan/denis";

const groups: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Use it",
    links: [
      { label: "Create a database", href: "/register" },
      { label: "Sign in", href: "/login" },
      { label: "Service status", href: "/api/health" },
    ],
  },
  {
    title: "Build with it",
    links: [
      { label: "Protocol reference", href: `${REPO}/blob/master/docs/PROTOCOL.md` },
      { label: "MCP server", href: `${REPO}/tree/master/clients/mcp` },
      { label: "Node.js client", href: `${REPO}/tree/master/clients/node` },
      { label: "Java driver", href: `${REPO}/tree/master/java-driver` },
    ],
  },
  {
    title: "The project",
    links: [
      { label: "Source on GitHub", href: REPO },
      { label: "Benchmarks", href: `${REPO}/blob/master/docs/BENCHMARKS.md` },
      { label: "Changelog", href: `${REPO}/blob/master/CHANGELOG.md` },
      { label: "MIT license", href: `${REPO}/blob/master/LICENSE` },
    ],
  },
];

export function LandingFooter({ version }: { version: string }) {
  return (
    <footer className="border-t border-[var(--l-line)]">
      <div className="mx-auto grid max-w-[1560px] gap-10 px-6 lg:px-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-[36ch]">
          <p className="text-[15px] font-medium">Denis Cloud</p>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--l-ash)]">
            Hosted Denis databases. Denis is an open-source Java engine: keys and tables in memory, journaled to disk, spoken to over a line protocol.
          </p>
          <p className="mt-4 font-mono text-[12px] text-[var(--l-ash)]">engine {version}</p>
        </div>
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-[13px] font-medium">{g.title}</p>
            <ul className="mt-3 grid gap-2">
              {g.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-[14px] text-[var(--l-ash)] transition-colors duration-300 hover:text-[var(--l-ink)]"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[1560px] px-6 lg:px-10 pb-8 text-[12.5px] text-[var(--l-ash)]">© {new Date().getFullYear()} Denis Database. Released under the MIT license.</div>
    </footer>
  );
}

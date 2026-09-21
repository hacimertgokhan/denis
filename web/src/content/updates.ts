/** Product updates shown in the right sidebar. Newest first. */
export type Update = { date: string; version: string; title: string; text: string; href?: string };

export const UPDATES: Update[] = [
  {
    date: "2026-09-21",
    version: "0.6.0",
    title: "QUERY: one round trip, many reads",
    text: "A GraphQL-shaped document fetches keys, prefixes and table rows together and returns only the fields you asked for. In the console, the Node client (graph) and MCP (denis_graph).",
    href: "https://github.com/hacimertgokhan/denis/blob/master/docs/PROTOCOL.md#query-one-round-trip-many-reads",
  },
  {
    date: "2026-09-21",
    version: "cloud",
    title: "Roles, database accounts and command history",
    text: "Share a database with teammates as admin, editor or viewer; give systems their own username at the database's login page; every command is now recorded with who ran it.",
    href: "/databases",
  },
  {
    date: "2026-09-21",
    version: "0.5.0",
    title: "Per-project quotas in the engine",
    text: "Storage and key limits are enforced by Denis itself; writes over the limit answer with code QUOTA instead of silently growing.",
    href: "https://github.com/hacimertgokhan/denis/blob/master/CHANGELOG.md",
  },
  {
    date: "2026-09-21",
    version: "0.4.0",
    title: "Indexed tables and an append-only journal",
    text: "Point queries went from 19 ms to 0.3 ms on 10k rows; a killed process no longer loses the last second of writes.",
    href: "https://github.com/hacimertgokhan/denis/blob/master/docs/BENCHMARKS.md",
  },
  {
    date: "2026-09-21",
    version: "0.3.0",
    title: "MCP server and structured replies",
    text: "AI assistants can inspect and query a database through MCP; SQL replies are typed JSON.",
    href: "https://github.com/hacimertgokhan/denis/blob/master/docs/PROTOCOL.md",
  },
];

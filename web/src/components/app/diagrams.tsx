/**
 * Inline SVG diagrams for the landing page. They use currentColor and the
 * theme's CSS variables, so they follow light/dark mode, and scale with the
 * container through viewBox.
 */

const stroke = "var(--border)";
const muted = "var(--muted-foreground)";
const fg = "var(--foreground)";
const accent = "var(--primary)";
const card = "var(--card)";
const soft = "var(--muted)";

function Box({ x, y, w, h, title, subtitle, strong }: { x: number; y: number; w: number; h: number; title: string; subtitle?: string; strong?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={strong ? accent : card} stroke={strong ? accent : stroke} strokeWidth={1.25} />
      <text
        x={x + w / 2}
        y={y + (subtitle ? h / 2 - 4 : h / 2 + 5)}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill={strong ? "var(--primary-foreground)" : fg}
      >
        {title}
      </text>
      {subtitle && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 14}
          textAnchor="middle"
          fontSize={11}
          fill={strong ? "var(--primary-foreground)" : muted}
          opacity={strong ? 0.85 : 1}
        >
          {subtitle}
        </text>
      )}
    </g>
  );
}

function Arrow({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke={muted} strokeWidth={1.5} markerEnd="url(#arrow)" />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" fontSize={10.5} fill={muted}>
          {label}
        </text>
      )}
    </g>
  );
}

const defs = (
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill={muted} />
    </marker>
  </defs>
);

/** Clients → gateway → engine → isolated projects. */
export function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 900 340" className="h-auto w-full font-sans" role="img" aria-labelledby="arch-title">
      <title id="arch-title">Denis Cloud architecture: three clients go through one gateway to isolated projects in the Denis engine</title>
      {defs}

      {/* clients */}
      <Box x={20} y={30} w={170} h={56} title="Web console" subtitle="you, signed in" />
      <Box x={20} y={140} w={170} h={56} title="Your application" subtitle="API key or JWT" />
      <Box x={20} y={250} w={170} h={56} title="AI assistant" subtitle="MCP over HTTP" />

      {/* gateway */}
      <rect x={300} y={60} width={220} height={220} rx={12} fill={soft} stroke={stroke} strokeWidth={1.25} />
      <text x={410} y={90} textAnchor="middle" fontSize={14} fontWeight={600} fill={fg}>
        Gateway
      </text>
      {["ownership check", "read / write scope", "daily command budget", "rate limit", "metering & charts"].map((line, i) => (
        <g key={line}>
          <circle cx={328} cy={118 + i * 30} r={3.5} fill={accent} />
          <text x={340} y={122 + i * 30} fontSize={12} fill={fg}>
            {line}
          </text>
        </g>
      ))}

      <Arrow d="M 190 58 C 250 58, 250 100, 300 100" label="session" lx={245} ly={68} />
      <Arrow d="M 190 168 L 300 168" label="REST /api/v1/exec" lx={245} ly={160} />
      <Arrow d="M 190 278 C 250 278, 250 236, 300 236" label="/api/mcp" lx={245} ly={288} />

      {/* engine */}
      <Box x={620} y={40} w={260} h={56} title="Denis engine" subtitle="one process, main token held by the platform" strong />
      <Arrow d="M 520 170 C 570 170, 570 68, 620 68" label="project token" lx={572} ly={112} />

      {[
        { y: 130, name: "project A", detail: "keys · tables · quota" },
        { y: 200, name: "project B", detail: "keys · tables · quota" },
        { y: 270, name: "project C", detail: "keys · tables · quota" },
      ].map((p) => (
        <g key={p.name}>
          <path d={`M 750 96 L 750 ${p.y + 28} L 660 ${p.y + 28}`} fill="none" stroke={stroke} strokeWidth={1.25} />
          <Box x={640} y={p.y} w={220} h={56} title={p.name} subtitle={p.detail} />
        </g>
      ))}
      <text x={750} y={334} textAnchor="middle" fontSize={11} fill={muted}>
        every project is its own namespace — nobody else can reach it
      </text>
    </svg>
  );
}

/** What an assistant does with the MCP tools. */
export function McpFlowDiagram() {
  const steps = [
    { x: 20, title: "You ask", subtitle: "“which products cost > 10?”" },
    { x: 240, title: "denis_describe", subtitle: "tables, columns, keys" },
    { x: 460, title: "denis_query", subtitle: "SELECT … WHERE price > 10" },
    { x: 680, title: "Answer", subtitle: "rows, as a table" },
  ];
  return (
    <svg viewBox="0 0 900 150" className="h-auto w-full font-sans" role="img" aria-labelledby="mcp-title">
      <title id="mcp-title">MCP flow: the assistant reads the schema with denis_describe, runs SQL with denis_query and answers</title>
      {defs}
      {steps.map((s, i) => (
        <g key={s.title}>
          <Box x={s.x} y={40} w={200} h={64} title={s.title} subtitle={s.subtitle} strong={i === 1 || i === 2} />
          {i < steps.length - 1 && <Arrow d={`M ${s.x + 200} 72 L ${s.x + 240} 72`} />}
        </g>
      ))}
      <text x={450} y={130} textAnchor="middle" fontSize={11} fill={muted}>
        read-only keys expose only the read tools; writes need a write-scoped key
      </text>
    </svg>
  );
}

/** Write path: journal at once, snapshot periodically. */
export function DurabilityDiagram() {
  return (
    <svg viewBox="0 0 900 150" className="h-auto w-full font-sans" role="img" aria-labelledby="dur-title">
      <title id="dur-title">Write path: memory, then the append-only journal, then periodic snapshots</title>
      {defs}
      <Box x={20} y={40} w={200} h={64} title="SET key value -&save" subtitle="acknowledged in memory" />
      <Arrow d="M 220 72 L 260 72" />
      <Box x={260} y={40} w={200} h={64} title="database.journal" subtitle="appended at once, fsync every 1 s" strong />
      <Arrow d="M 460 72 L 500 72" label="every 30 s" lx={480} ly={60} />
      <Box x={500} y={40} w={200} h={64} title="database.bin" subtitle="atomic snapshot" />
      <Arrow d="M 700 72 L 740 72" label="restart" lx={720} ly={60} />
      <Box x={740} y={40} w={140} h={64} title="Recovered" subtitle="snapshot + replay" />
      <text x={450} y={130} textAnchor="middle" fontSize={11} fill={muted}>
        a killed process loses nothing; a power loss loses at most one second
      </text>
    </svg>
  );
}

/**
 * Three sources feeding one console: the app over the protocol, the
 * assistant over MCP, a person at the console. Dashed lines carry a moving
 * pulse (CSS stroke-dashoffset, see .lf-flow) into the console frame below.
 */
export function HeroSignal() {
  const sources: { x: number; title: string; sub: string }[] = [
    { x: 110, title: "Your application", sub: "REST · Node.js client" },
    { x: 450, title: "AI assistant", sub: "MCP over HTTP" },
    { x: 790, title: "You", sub: "web console" },
  ];
  return (
    <svg
      viewBox="0 0 900 132"
      className="h-auto w-full font-sans"
      role="img"
      aria-label="An application, an AI assistant and a person all talk to the same database"
    >
      <defs>
        <marker id="hs-dot" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="6" markerHeight="6">
          <circle cx="3" cy="3" r="2.2" fill="var(--l-ink)" />
        </marker>
      </defs>
      {sources.map((s) => (
        <g key={s.title}>
          <rect x={s.x - 100} y={8} width={200} height={50} rx={9} fill="var(--card)" stroke="var(--l-line)" />
          <text x={s.x} y={30} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--l-ink)">
            {s.title}
          </text>
          <text x={s.x} y={47} textAnchor="middle" fontSize={11} fill="var(--l-ash)">
            {s.sub}
          </text>
          {/* the wire: down, then toward the middle, then into the console */}
          <path d={`M ${s.x} 58 C ${s.x} 92, 450 86, 450 122`} fill="none" stroke="var(--l-line)" strokeWidth={1.25} />
          <path
            d={`M ${s.x} 58 C ${s.x} 92, 450 86, 450 122`}
            fill="none"
            stroke="var(--l-ink)"
            strokeWidth={1.25}
            strokeDasharray="6 12"
            className="lf-flow"
            opacity={0.9}
          />
        </g>
      ))}
      <circle cx={450} cy={124} r={4} fill="var(--l-ink)" />
      <text x={464} y={128} fontSize={11} fill="var(--l-ash)" fontFamily="var(--font-plex-mono), monospace">
        one gateway · one project per database
      </text>
    </svg>
  );
}

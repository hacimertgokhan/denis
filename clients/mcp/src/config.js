/**
 * Server configuration, read from the environment so the MCP host (Claude
 * Desktop, Claude Code, Cursor, ...) can pass it in its `env` block.
 *
 *   DENIS_HOST       server host            default 127.0.0.1
 *   DENIS_PORT       server port            default 5142
 *   DENIS_GROUP      login group (LIN)      required
 *   DENIS_PASSWORD   group password         required
 *   DENIS_TOKEN      project token (AUTH)   optional; a project is created when missing
 *   DENIS_READ_ONLY  "1" hides every tool that writes (set/delete/execute/clear)
 *   DENIS_MAX_ROWS   cap on rows returned by denis_query   default 200
 */
export function loadConfig(env = process.env) {
  const missing = ["DENIS_GROUP", "DENIS_PASSWORD"].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  return {
    host: env.DENIS_HOST || "127.0.0.1",
    port: Number(env.DENIS_PORT || 5142),
    group: env.DENIS_GROUP,
    password: env.DENIS_PASSWORD,
    token: env.DENIS_TOKEN || undefined,
    createProject: !env.DENIS_TOKEN,
    readOnly: env.DENIS_READ_ONLY === "1" || env.DENIS_READ_ONLY === "true",
    maxRows: Math.max(1, Number(env.DENIS_MAX_ROWS || 200)),
  };
}

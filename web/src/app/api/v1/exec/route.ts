import { handler, ok, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { authenticateRequest, checkRateLimit } from "@/lib/api-keys";
import { runCommand } from "@/lib/databases";

/**
 * Programmatic access with an API key or access token:
 *   POST /api/v1/exec   Authorization: Bearer dk_...   { "command": "GET greeting" }
 *   -> { "reply": {"ok":true,"key":"greeting","data":"hello"}, "latencyMs": 0.4 }
 * or { "commands": [...] } -> { "results": [...] } (up to 50, in order).
 */
export const POST = handler(async (request: Request) => {
  const principal = await authenticateRequest(request);
  checkRateLimit(principal.keyId);
  const body = await readJson<{ command?: string; commands?: string[] }>(request);
  const readOnly = principal.scope === "read";
  if (body.commands) {
    const lines = body.commands.map((l) => String(l).trim()).filter(Boolean);
    if (lines.length === 0 || lines.length > 50) throw new GatewayError("Send 1-50 commands", 400, "BAD_REQUEST");
    const results = [];
    for (const line of lines) {
      try {
        const r = await runCommand(principal.database, line, {
          readOnly,
          source: "api",
          actor: { type: "apikey", id: principal.keyId, label: principal.keyName },
        });
        results.push({ command: line, reply: r.reply, latencyMs: Math.round(r.latencyMs * 100) / 100 });
      } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
        results.push({ command: line, reply: { ok: false, error: err.message, code: err.code }, latencyMs: 0 });
        if (err.code === "OPS_QUOTA") break;
      }
    }
    return ok({ results });
  }
  const line = String(body.command ?? "").trim();
  if (!line) throw new GatewayError("command is required", 400, "BAD_REQUEST");
  const r = await runCommand(principal.database, line, { readOnly, source: "api", actor: { type: "apikey", id: principal.keyId, label: principal.keyName } });
  return ok({ reply: r.reply, latencyMs: Math.round(r.latencyMs * 100) / 100 });
});

/** Who am I: the database and scope behind a credential. */
export const GET = handler(async (request: Request) => {
  const principal = await authenticateRequest(request);
  return ok({ database: { id: principal.database.id, name: principal.database.name }, scope: principal.scope, via: principal.via });
});

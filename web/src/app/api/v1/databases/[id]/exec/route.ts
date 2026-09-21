import { handler, ok, readJson } from "@/lib/api";
import { can, requestAccess } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";
import { runCommand } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

/** Web console: run one or more protocol lines as a platform user or a database-local account. */
export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "read");
  const body = await readJson<{ command?: string; commands?: string[] }>(request);
  const lines = (body.commands ?? (body.command ? [body.command] : [])).map((l) => String(l).trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 50) throw new GatewayError("Send 1-50 commands", 400, "BAD_REQUEST");
  const readOnly = !can(actor.role, "write");
  const results = [];
  for (const line of lines) {
    try {
      const r = await runCommand(database, line, { source: "console", readOnly, actor: { type: actor.type, id: actor.id, label: actor.label } });
      results.push({ command: line, reply: r.reply, latencyMs: Math.round(r.latencyMs * 100) / 100 });
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      results.push({ command: line, reply: { ok: false, error: err.message, code: err.code }, latencyMs: 0 });
      if (err.code === "OPS_QUOTA") break;
    }
  }
  return ok({ results, role: actor.role });
});

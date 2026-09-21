import { currentUser } from "@/lib/session";
import { handler, ok, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { getOwnedDatabase, runCommand } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

/** Web console: run one or more protocol lines as the signed-in owner. */
export const POST = handler(async (request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  const body = await readJson<{ command?: string; commands?: string[] }>(request);
  const lines = (body.commands ?? (body.command ? [body.command] : [])).map((l) => String(l).trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 50) throw new GatewayError("Send 1-50 commands", 400, "BAD_REQUEST");
  const results = [];
  for (const line of lines) {
    try {
      const r = await runCommand(database, line, { source: "console" });
      results.push({ command: line, reply: r.reply, latencyMs: Math.round(r.latencyMs * 100) / 100 });
    } catch (err) {
      if (!(err instanceof GatewayError)) throw err;
      results.push({ command: line, reply: { ok: false, error: err.message, code: err.code }, latencyMs: 0 });
      if (err.code === "OPS_QUOTA") break;
    }
  }
  return ok({ results });
});

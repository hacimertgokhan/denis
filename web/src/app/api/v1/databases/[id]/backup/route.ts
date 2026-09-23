import { handler, ok } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { exportDatabase, restoreDatabase } from "@/lib/backup";
import { GatewayError } from "@/lib/denis/client";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** GET: the whole database as a zip (anyone who can read it). */
export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "read");
  rateLimit(`backup:${actor.type}:${actor.id}`, LIMITS.account.max, LIMITS.account.windowMs, "backups");
  const { zip } = await exportDatabase(database, actor.type === "user" ? actor.id : null);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${database.slug}-${stamp}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
});

/**
 * POST: restore from a backup zip (owners and admins). multipart/form-data
 * with `file` and `mode` = merge (default) | replace (empties the database first).
 */
export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "manage_database");
  rateLimit(`restore:${actor.type}:${actor.id}`, LIMITS.account.max, LIMITS.account.windowMs, "restores");
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) throw new GatewayError("Send multipart/form-data with a file field", 415, "UNSUPPORTED_MEDIA_TYPE");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new GatewayError("file is required", 400, "BAD_REQUEST");
  const mode = form.get("mode") === "replace" ? "replace" : "merge";
  const report = await restoreDatabase(database, new Uint8Array(await file.arrayBuffer()), mode, actor.type === "user" ? actor.id : null);
  return ok({ mode, report });
});

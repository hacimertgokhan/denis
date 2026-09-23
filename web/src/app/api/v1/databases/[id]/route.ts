import { handler, ok, publicDatabase, readJson } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { deleteDatabase, renameDatabase, resetDatabase, sampleUsage } from "@/lib/databases";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "read");
  return ok({ database: publicDatabase(await sampleUsage(database)), role: actor.role });
});

export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "manage_database");
  const body = await readJson<{ name?: string; action?: "reset" }>(request);
  if (body.action === "reset") {
    await resetDatabase(database.userId, id);
  } else if (body.name !== undefined) {
    await renameDatabase(database.userId, id, String(body.name));
  }
  const fresh = await requestAccess(id, "read");
  return ok({ database: publicDatabase(fresh.database), role: actor.role });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "manage_database");
  if (actor.role !== "owner") throw new GatewayError("Only the owner can delete a database", 403, "FORBIDDEN");
  await deleteDatabase(database.userId, id);
  return ok({ deleted: true });
});

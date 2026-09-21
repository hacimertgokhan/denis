import { currentUser } from "@/lib/session";
import { handler, ok, publicDatabase, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { deleteDatabase, getOwnedDatabase, renameDatabase, resetDatabase, sampleUsage } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const row = await getOwnedDatabase(user.id, id);
  if (!row) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  return ok({ database: publicDatabase(await sampleUsage(row)) });
});

export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const body = await readJson<{ name?: string; action?: "reset" }>(request);
  if (body.action === "reset") {
    await resetDatabase(user.id, id);
  } else if (body.name !== undefined) {
    await renameDatabase(user.id, id, String(body.name));
  }
  const row = await getOwnedDatabase(user.id, id);
  if (!row) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  return ok({ database: publicDatabase(row) });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  await deleteDatabase(user.id, id);
  return ok({ deleted: true });
});

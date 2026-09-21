import { handler, ok, publicKey, readJson } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { createApiKey, listApiKeys } from "@/lib/api-keys";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database } = await requestAccess(id, "manage_keys");
  return ok({ keys: (await listApiKeys(database.id)).map(publicKey) });
});

export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database, actor } = await requestAccess(id, "manage_keys");
  const body = await readJson<{ name?: string; scope?: "read" | "write" }>(request);
  const scope = body.scope === "read" ? "read" : "write";
  // keys created by a database-local admin are attributed to the owner
  const userId = actor.type === "user" ? actor.id : database.userId;
  const { row, secret } = await createApiKey(userId, database, String(body.name ?? "default"), scope);
  return ok({ key: publicKey(row), secret }, { status: 201 });
});

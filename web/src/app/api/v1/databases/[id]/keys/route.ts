import { currentUser } from "@/lib/session";
import { handler, ok, publicKey, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { getOwnedDatabase } from "@/lib/databases";
import { createApiKey, listApiKeys } from "@/lib/api-keys";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  return ok({ keys: (await listApiKeys(database.id)).map(publicKey) });
});

export const POST = handler(async (request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  const body = await readJson<{ name?: string; scope?: "read" | "write" }>(request);
  const scope = body.scope === "read" ? "read" : "write";
  const { row, secret } = await createApiKey(user.id, database, String(body.name ?? "default"), scope);
  // the secret is returned exactly once
  return ok({ key: publicKey(row), secret }, { status: 201 });
});

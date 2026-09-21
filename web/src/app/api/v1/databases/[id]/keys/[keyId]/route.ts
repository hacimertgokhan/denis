import { handler, ok } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { revokeApiKeyInDatabase } from "@/lib/api-keys";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string; keyId: string }> };

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const { id, keyId } = await params;
  const { database, actor } = await requestAccess(id, "manage_keys");
  const row = await revokeApiKeyInDatabase(database.id, keyId, actor.type === "user" ? actor.id : database.userId);
  if (!row) throw new GatewayError("Key not found", 404, "NOT_FOUND");
  return ok({ revoked: true });
});

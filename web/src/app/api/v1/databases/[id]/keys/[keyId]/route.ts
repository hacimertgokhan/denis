import { currentUser } from "@/lib/session";
import { handler, ok } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { revokeApiKey } from "@/lib/api-keys";

type Ctx = { params: Promise<{ id: string; keyId: string }> };

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { keyId } = await params;
  const row = await revokeApiKey(user.id, keyId);
  if (!row) throw new GatewayError("Key not found", 404, "NOT_FOUND");
  return ok({ revoked: true });
});

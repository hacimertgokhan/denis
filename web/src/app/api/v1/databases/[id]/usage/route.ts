import { currentUser } from "@/lib/session";
import { handler, ok } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { getOwnedDatabase, opsToday, sampleUsage, usageHistory } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (request: Request, { params }: Ctx) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const { id } = await params;
  const row = await getOwnedDatabase(user.id, id);
  if (!row) throw new GatewayError("Database not found", 404, "NOT_FOUND");
  const days = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 7)));
  const [database, history, today] = await Promise.all([sampleUsage(row), usageHistory(row.id, days), opsToday(row.id)]);
  return ok({
    usage: {
      cachedKeys: database.cachedKeys,
      cachedBytes: database.cachedBytes,
      persistedKeys: database.persistedKeys,
      persistedBytes: database.persistedBytes,
      opsToday: today,
      limits: { maxBytes: database.maxBytes, maxKeys: database.maxKeys, opsPerDay: database.opsPerDay },
    },
    history,
  });
});

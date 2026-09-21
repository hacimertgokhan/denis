import { handler, ok } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { opsToday, sampleUsage, usageHistory } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database: row } = await requestAccess(id, "read");
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

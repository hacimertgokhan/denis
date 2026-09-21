import { handler, ok } from "@/lib/api";
import { authenticateRequest } from "@/lib/api-keys";
import { opsToday, sampleUsage } from "@/lib/databases";

/**
 * Usage and limits of the database behind an API key or access token:
 *   GET /api/v1/usage   Authorization: Bearer dk_...
 *   -> { database, scope, usage: {cachedKeys, cachedBytes, persistedKeys, persistedBytes, opsToday, sampledAt},
 *        limits: {maxBytes, maxKeys, opsPerDay} }
 */
export const GET = handler(async (request: Request) => {
  const principal = await authenticateRequest(request);
  const [database, today] = await Promise.all([sampleUsage(principal.database).catch(() => principal.database), opsToday(principal.database.id)]);
  return ok({
    database: { id: database.id, name: database.name },
    scope: principal.scope,
    usage: {
      cachedKeys: database.cachedKeys,
      cachedBytes: database.cachedBytes,
      persistedKeys: database.persistedKeys,
      persistedBytes: database.persistedBytes,
      opsToday: today,
      sampledAt: database.usageSampledAt,
    },
    limits: { maxBytes: database.maxBytes, maxKeys: database.maxKeys, opsPerDay: database.opsPerDay },
  });
});

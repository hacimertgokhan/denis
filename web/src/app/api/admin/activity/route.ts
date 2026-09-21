import { handler, ok } from "@/lib/api";
import { adminAuditLog, adminRecentCommands, requireAdminApi } from "@/lib/admin";

/** ?q=<text>&limit=100&failed=1 */
export const GET = handler(async (request: Request) => {
  await requireAdminApi();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
  const failedOnly = url.searchParams.get("failed") === "1";
  const [audit, commands] = await Promise.all([adminAuditLog({ q, limit }), adminRecentCommands({ limit, failedOnly })]);
  return ok({ audit, commands });
});

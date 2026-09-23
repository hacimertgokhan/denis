import { handler, ok } from "@/lib/api";
import { adminListAccounts, requireAdminApi } from "@/lib/admin";

/** ?q=<username, database or owner email>&limit=200 */
export const GET = handler(async (request: Request) => {
  await requireAdminApi();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
  return ok({ accounts: await adminListAccounts({ q, limit }) });
});

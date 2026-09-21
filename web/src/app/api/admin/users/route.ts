import { handler, ok } from "@/lib/api";
import { adminListUsers, requireAdminApi } from "@/lib/admin";

/** ?q=<name or email>&limit=100 */
export const GET = handler(async (request: Request) => {
  await requireAdminApi();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
  return ok({ users: await adminListUsers({ q, limit }) });
});

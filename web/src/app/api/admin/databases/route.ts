import { handler, ok } from "@/lib/api";
import { adminListDatabases, engineProjects, requireAdminApi } from "@/lib/admin";

/** ?q=<name, owner email or id>&limit=200 */
export const GET = handler(async (request: Request) => {
  await requireAdminApi();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
  const [databases, engine] = await Promise.all([adminListDatabases({ q, limit }), engineProjects()]);
  return ok({ databases, engineProjects: engine?.length ?? null });
});

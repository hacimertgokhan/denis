import { handler, ok } from "@/lib/api";
import { requestAccess } from "@/lib/access";
import { commandHistory, commandHistoryCount, historySummary } from "@/lib/databases";

type Ctx = { params: Promise<{ id: string }> };

/** Command history, paged: ?q=text&failed=1&page=1&limit=50 */
export const GET = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database } = await requestAccess(id, "view_history");
  const url = new URL(request.url);
  const filter = { q: url.searchParams.get("q") ?? undefined, failedOnly: url.searchParams.get("failed") === "1" };
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const [entries, total, summary] = await Promise.all([
    commandHistory(database.id, { ...filter, limit, offset: (page - 1) * limit }),
    commandHistoryCount(database.id, filter),
    historySummary(database.id),
  ]);
  return ok({ entries, summary, page, pages: Math.max(1, Math.ceil(total / limit)), total, limit });
});

import { handler, ok } from "@/lib/api";
import { adminStats, engineInfo, requireAdminApi } from "@/lib/admin";

export const GET = handler(async () => {
  await requireAdminApi();
  const [stats, engine] = await Promise.all([adminStats(), engineInfo()]);
  return ok({ stats, engine });
});

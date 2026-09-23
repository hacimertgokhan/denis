import { handler, ok, readJson } from "@/lib/api";
import { adminUpdateUser, requireAdminApi } from "@/lib/admin";

type Ctx = { params: Promise<{ userId: string }> };

/** Body: { role?: "user" | "admin", disabled?: boolean, maxDatabases?: number | null } */
export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const admin = await requireAdminApi();
  const { userId } = await params;
  const body = await readJson<{ role?: string; disabled?: boolean; maxDatabases?: number | null }>(request);
  await adminUpdateUser(admin, userId, body);
  return ok({ updated: true });
});

import { handler, ok, readJson } from "@/lib/api";
import { adminDeleteDatabase, adminUpdateDatabase, requireAdminApi } from "@/lib/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Body: { maxBytes?, maxKeys?, opsPerDay? } */
export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const admin = await requireAdminApi();
  const { id } = await params;
  const body = await readJson<{ maxBytes?: number; maxKeys?: number; opsPerDay?: number }>(request);
  await adminUpdateDatabase(admin, id, body);
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const admin = await requireAdminApi();
  const { id } = await params;
  await adminDeleteDatabase(admin, id);
  return ok({ deleted: true });
});

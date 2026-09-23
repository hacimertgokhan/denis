import { handler, ok, readJson } from "@/lib/api";
import { adminDeleteAccount, adminUpdateAccount, requireAdminApi } from "@/lib/admin";

type Ctx = { params: Promise<{ accountId: string }> };

export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const admin = await requireAdminApi();
  const { accountId } = await params;
  const body = await readJson<{ disabled?: boolean }>(request);
  await adminUpdateAccount(admin, accountId, body);
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const admin = await requireAdminApi();
  const { accountId } = await params;
  await adminDeleteAccount(admin, accountId);
  return ok({ deleted: true });
});

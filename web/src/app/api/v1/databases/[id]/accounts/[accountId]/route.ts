import { handler, ok, readJson } from "@/lib/api";
import { deleteAccount, isRole, requestAccess, updateAccount, type Role } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string; accountId: string }> };

export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const { id, accountId } = await params;
  const access = await requestAccess(id, "manage_access");
  const body = await readJson<{ role?: string; password?: string; disabled?: boolean }>(request);
  if (body.role !== undefined && !isRole(body.role)) throw new GatewayError("role must be admin, editor or viewer", 400, "INVALID_ROLE");
  const row = await updateAccount(access, accountId, { role: body.role as Role | undefined, password: body.password, disabled: body.disabled });
  return ok({ account: { id: row.id, username: row.username, role: row.role, disabledAt: row.disabledAt } });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const { id, accountId } = await params;
  const access = await requestAccess(id, "manage_access");
  if (!(await deleteAccount(access, accountId))) throw new GatewayError("Account not found", 404, "NOT_FOUND");
  return ok({ deleted: true });
});

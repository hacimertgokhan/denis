import { handler, ok, readJson } from "@/lib/api";
import { createAccount, isRole, listAccounts, requestAccess } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database } = await requestAccess(id, "manage_access");
  return ok({ accounts: await listAccounts(database.id) });
});

export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const access = await requestAccess(id, "manage_access");
  const body = await readJson<{ username?: string; password?: string; role?: string }>(request);
  if (!isRole(body.role)) throw new GatewayError("role must be admin, editor or viewer", 400, "INVALID_ROLE");
  const row = await createAccount(access, String(body.username ?? ""), String(body.password ?? ""), body.role);
  return ok({ account: { id: row.id, username: row.username, role: row.role, createdAt: row.createdAt } }, { status: 201 });
});

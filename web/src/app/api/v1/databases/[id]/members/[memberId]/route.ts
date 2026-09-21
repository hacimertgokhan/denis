import { handler, ok, readJson } from "@/lib/api";
import { isRole, removeMember, requestAccess, updateMemberRole } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string; memberId: string }> };

export const PATCH = handler(async (request: Request, { params }: Ctx) => {
  const { id, memberId } = await params;
  const access = await requestAccess(id, "manage_access");
  const body = await readJson<{ role?: string }>(request);
  if (!isRole(body.role)) throw new GatewayError("role must be admin, editor or viewer", 400, "INVALID_ROLE");
  if (!(await updateMemberRole(access, memberId, body.role))) throw new GatewayError("Member not found", 404, "NOT_FOUND");
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Ctx) => {
  const { id, memberId } = await params;
  const access = await requestAccess(id, "manage_access");
  if (!(await removeMember(access, memberId))) throw new GatewayError("Member not found", 404, "NOT_FOUND");
  return ok({ removed: true });
});

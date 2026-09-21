import { handler, ok, readJson } from "@/lib/api";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { addMember, isRole, listMembers, requestAccess } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { database } = await requestAccess(id, "manage_access");
  return ok({ members: await listMembers(database.id) });
});

export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const access = await requestAccess(id, "manage_access");
  rateLimit(`manage:${access.actor.type}:${access.actor.id}`, LIMITS.manage.max, LIMITS.manage.windowMs, "changes");
  const body = await readJson<{ email?: string; role?: string }>(request);
  if (!body.email) throw new GatewayError("email is required", 400, "BAD_REQUEST");
  if (!isRole(body.role)) throw new GatewayError("role must be admin, editor or viewer", 400, "INVALID_ROLE");
  await addMember(access, body.email, body.role);
  return ok({ members: await listMembers(access.database.id) }, { status: 201 });
});

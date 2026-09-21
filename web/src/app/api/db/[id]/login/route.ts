import { cookies } from "next/headers";
import { handler, ok, readJson } from "@/lib/api";
import { dbCookieName, signInAccount } from "@/lib/access";
import { GatewayError } from "@/lib/denis/client";
import { env } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

/** Database-local sign-in: sets an httpOnly cookie for this database only. */
export const POST = handler(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ username?: string; password?: string }>(request);
  if (!body.username || !body.password) throw new GatewayError("username and password are required", 400, "BAD_REQUEST");
  const { token, maxAge, account } = await signInAccount(id, body.username, body.password);
  const jar = await cookies();
  jar.set(dbCookieName(id), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NEXT_PUBLIC_APP_URL.startsWith("https://"),
    path: "/",
    maxAge,
  });
  return ok({ account: { id: account.id, username: account.username, role: account.role } });
});

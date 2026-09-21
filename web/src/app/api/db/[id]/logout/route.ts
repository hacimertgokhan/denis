import { cookies } from "next/headers";
import { handler, ok } from "@/lib/api";
import { dbCookieName } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const jar = await cookies();
  jar.delete(dbCookieName(id));
  return ok({ signedOut: true });
});

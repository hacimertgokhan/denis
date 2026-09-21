import { currentUser } from "@/lib/session";
import { handler, ok } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { plan } from "@/lib/env";
import { countDatabases } from "@/lib/databases";

export const GET = handler(async () => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const used = await countDatabases(user.id);
  return ok({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    plan: { ...plan(), maxDatabases: user.maxDatabases, databasesUsed: used },
  });
});

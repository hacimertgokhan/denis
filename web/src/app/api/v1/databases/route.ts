import { currentUser } from "@/lib/session";
import { handler, ok, publicDatabase, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { createDatabase, listDatabases } from "@/lib/databases";

export const GET = handler(async () => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const rows = await listDatabases(user.id);
  return ok({ databases: rows.map(publicDatabase) });
});

export const POST = handler(async (request: Request) => {
  const user = await currentUser();
  if (!user) throw new GatewayError("Not signed in", 401, "UNAUTHORIZED");
  const body = await readJson<{ name?: string; region?: string }>(request);
  const row = await createDatabase(user.id, String(body.name ?? ""), body.region || "eu-central");
  return ok({ database: publicDatabase(row) }, { status: 201 });
});

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { DbLoginForm } from "@/components/app/db-login-form";
import { currentAccountAccess } from "@/lib/access";
import { db, schema } from "@/lib/db";

export const metadata = { title: "Sign in to your database", robots: { index: false, follow: false } };

export default async function DbLoginPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [database] = await db
    .select({ id: schema.databases.id, name: schema.databases.name })
    .from(schema.databases)
    .where(eq(schema.databases.id, id))
    .limit(1);
  if (!database) notFound();
  if (await currentAccountAccess(id)) redirect(`/db/${id}`);
  return <DbLoginForm databaseId={database.id} databaseName={database.name} />;
}

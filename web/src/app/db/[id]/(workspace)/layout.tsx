import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DatabaseTabs } from "@/components/app/database-tabs";
import { DbSignOutButton } from "@/components/app/db-login-form";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { currentAccountAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** The shell a database-local account sees: this database and nothing else. */
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await currentAccountAccess(id);
  if (!access) redirect(`/db/${id}/login`);
  const { database, actor } = access;
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[1400px] flex-col border-x">
      <header className="flex h-14 items-center justify-between border-b px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href={`/db/${id}`} className="text-[15px] font-medium tracking-tight">
            {database.name}
          </Link>
          <Badge variant="secondary">{actor.role}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[13.5px]">
          <span className="text-muted-foreground">
            signed in as <span className="text-foreground font-mono">{actor.label}</span>
          </span>
          <ThemeToggle />
          <DbSignOutButton databaseId={id} />
        </div>
      </header>
      <div className="border-b px-5 lg:px-8">
        <DatabaseTabs id={id} role={actor.role} base={`/db/${id}`} />
      </div>
      <div className="flex w-full flex-1 flex-col gap-6 px-5 py-5 lg:px-8 lg:py-8">{children}</div>
      <footer className="text-muted-foreground border-t px-5 py-3 text-[12px] lg:px-8">
        Every command you run here is recorded in the history with your username.
      </footer>
    </div>
  );
}

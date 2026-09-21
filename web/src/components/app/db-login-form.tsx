"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthAtmosphere } from "@/components/landing/atmosphere";
import { apiFetch } from "@/lib/client-api";

const field =
  "h-11 w-full rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 text-[15px] text-[var(--l-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--l-ash)]/70 focus:border-[var(--l-ink)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--l-ash)_22%,transparent)]";

/**
 * Sign-in for database-local accounts: no platform account involved.
 * Split layout like the platform sign-in — the silk panel names the database,
 * the form sits on plain paper — but unbranded, so the page can be handed to
 * people who never see the rest of the platform.
 */
export function DbLoginForm({ databaseId, databaseName }: { databaseId: string; databaseName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    try {
      await apiFetch(`/api/db/${databaseId}/login`, {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      router.push(`/db/${databaseId}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing grid min-h-screen lg:grid-cols-[1fr_minmax(0,34rem)]">
      {/* the silk panel: black with a soft grey light, dimmed so the text carries */}
      <aside className="relative hidden overflow-hidden bg-black lg:block">
        <AuthAtmosphere intensity={0.55} className="absolute inset-0 h-full rounded-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,transparent_20%,rgba(0,0,0,0.55)_100%)]" aria-hidden />
        <div className="relative flex h-full min-h-screen flex-col justify-between p-10 text-white lg:p-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12.5px] text-white/70 backdrop-blur-md">
            <KeyRoundIcon className="size-3.5" /> Database workspace
          </span>
          <div className="max-w-[30rem]">
            <p className="font-mono text-[11px] tracking-[0.18em] text-white/40 uppercase">Database</p>
            <p className="mt-3 truncate text-[2.75rem] leading-[1.05] font-medium tracking-[-0.02em] text-balance">{databaseName}</p>
            <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-white/60">
              This sign-in is for this database only. Your role decides what you can do: viewers read, editors write, admins manage keys and access.
            </p>
          </div>
          <p className="text-[13px] text-white/35">Ask the database owner for a username if you do not have one.</p>
        </div>
      </aside>

      {/* the form */}
      <div className="flex flex-col bg-[var(--l-bg)] px-6 py-8 sm:px-10 lg:border-l lg:border-[var(--l-line)]">
        <span className="inline-flex w-fit items-center gap-2 text-[13px] text-[var(--l-ash)] lg:hidden">
          <KeyRoundIcon className="size-3.5" /> Database workspace
        </span>
        <div className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
          <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--l-ash)] uppercase lg:hidden">Database</p>
          <h1 className="mt-2 text-[1.75rem] leading-tight font-medium tracking-[-0.01em] lg:mt-0">
            Sign in to <span className="font-mono">{databaseName}</span>
          </h1>
          <p className="mt-2 text-[15px] text-[var(--l-ash)]">Use the username and password you were given.</p>
          <form
            className="mt-8 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(new FormData(e.currentTarget));
            }}
          >
            <label className="grid gap-1.5 text-[13.5px] font-medium">
              Username
              <input name="username" required autoComplete="username" spellCheck={false} className={field + " font-mono"} autoFocus />
            </label>
            <label className="grid gap-1.5 text-[13.5px] font-medium">
              Password
              <input name="password" type="password" required autoComplete="current-password" className={field} />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-ink)] text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2Icon className="size-4 animate-spin" />} Sign in
            </button>
          </form>
        </div>
        <p className="text-[12.5px] text-[var(--l-ash)]">Every command you run is recorded in the database history with your username.</p>
      </div>
    </div>
  );
}

export function DbSignOutButton({ databaseId }: { databaseId: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await apiFetch(`/api/db/${databaseId}/logout`, {
          method: "POST",
        });
        router.push(`/db/${databaseId}/login`);
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}

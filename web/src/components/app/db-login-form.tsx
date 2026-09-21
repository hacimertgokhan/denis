"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AuthAtmosphere } from "@/components/landing/atmosphere";
import { apiFetch } from "@/lib/client-api";

const field =
  "h-11 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 text-[15px] text-white outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-white/30 hover:bg-white/[0.08] focus:border-white/40 focus:bg-white/[0.08] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.08)]";

/**
 * Sign-in for database-local accounts: no platform account involved.
 * A single frosted card over a dimmed aurora; deliberately unbranded so it
 * can be handed to people who never see the rest of the platform.
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
    <div className="landing relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <AuthAtmosphere intensity={0.4} className="h-full min-h-screen rounded-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />
      </div>

      <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-[25rem]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl backdrop-saturate-150 sm:p-9">
            <p className="font-mono text-[11px] tracking-[0.18em] text-white/40 uppercase">Database</p>
            <h1 className="mt-2 truncate text-[1.75rem] leading-tight font-medium tracking-[-0.015em] text-white">{databaseName}</h1>
            <p className="mt-2 text-[14px] text-white/55">Sign in with the username you were given for this database.</p>
            <form
              className="mt-8 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(new FormData(e.currentTarget));
              }}
            >
              <label className="grid gap-1.5 text-[13px] font-medium text-white/80">
                Username
                <input name="username" required autoComplete="username" spellCheck={false} className={field + " font-mono"} autoFocus />
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium text-white/80">
                Password
                <input name="password" type="password" required autoComplete="current-password" className={field} />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white text-[15px] font-medium text-black transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              >
                {busy && <Loader2Icon className="size-4 animate-spin" />} Sign in
              </button>
            </form>
          </div>
          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-white/35">
            Your role decides what you can do here. Every command is recorded in the history with your username.
          </p>
        </div>
      </main>
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

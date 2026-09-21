"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/app/brand-icons";
import { ConsoleDemo } from "@/components/landing/console-demo";
import { authClient } from "@/lib/auth-client";

const field =
  "h-11 w-full rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 text-[15px] text-[var(--l-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--l-ash)]/70 focus:border-[var(--l-ink)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--l-honey)_25%,transparent)]";

export function AuthForm({ mode, githubEnabled }: { mode: "login" | "register"; githubEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const result =
      mode === "register"
        ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "That did not work. Check the details and try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="landing grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* left: the product at rest */}
      <aside className="hidden flex-col justify-between bg-[var(--l-console)] p-10 text-[var(--l-console-text)] lg:flex">
        <Link href="/" className="text-[15px] font-medium tracking-tight">
          Denis Cloud
        </Link>
        <div className="my-10 max-w-[34rem]">
          <p className="mb-6 max-w-[30ch] text-[1.6rem] leading-[1.25] font-medium tracking-[-0.01em] text-balance">
            Keys, small tables and an MCP endpoint, one line at a time.
          </p>
          <div className="[&>div]:border-white/10 [&>div]:shadow-none">
            <ConsoleDemo autoplay={false} />
          </div>
        </div>
        <p className="text-[13px] text-[var(--l-console-dim)]">Open source engine. Free hosting for three databases per account.</p>
      </aside>

      {/* right: the form */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Link href="/" className="text-[15px] font-medium tracking-tight lg:hidden">
            Denis Cloud
          </Link>
          <p className="text-[14px] text-[var(--l-ash)]">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link href="/register" className="text-[var(--l-ink)] underline decoration-[var(--l-line)] underline-offset-4 hover:decoration-[var(--l-ink)]">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-[var(--l-ink)] underline decoration-[var(--l-line)] underline-offset-4 hover:decoration-[var(--l-ink)]">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
          <h1 className="text-[1.75rem] leading-tight font-medium tracking-[-0.01em]">{mode === "login" ? "Sign in" : "Create your account"}</h1>
          <p className="mt-2 text-[15px] text-[var(--l-ash)]">
            {mode === "login" ? "Pick up where you left off." : "Your first database is a minute away."}
          </p>

          <form
            className="mt-8 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(new FormData(e.currentTarget));
            }}
          >
            {mode === "register" && (
              <label className="grid gap-1.5 text-[13.5px] font-medium">
                Name
                <input name="name" autoComplete="name" placeholder="Ada Lovelace" className={field} />
              </label>
            )}
            <label className="grid gap-1.5 text-[13.5px] font-medium">
              Email
              <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} />
            </label>
            <label className="grid gap-1.5 text-[13.5px] font-medium">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "At least 8 characters" : undefined}
                className={field}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-ink)] text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
            {githubEnabled && (
              <>
                <div className="my-1 flex items-center gap-3 text-[12.5px] text-[var(--l-ash)]">
                  <span className="h-px flex-1 bg-[var(--l-line)]" />
                  or
                  <span className="h-px flex-1 bg-[var(--l-line)]" />
                </div>
                <button
                  type="button"
                  onClick={() => authClient.signIn.social({ provider: "github", callbackURL: next })}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--l-line)] bg-[var(--card)] text-[15px] font-medium transition-colors hover:border-[var(--l-ink)]"
                >
                  <GitHubIcon className="size-4" /> Continue with GitHub
                </button>
              </>
            )}
          </form>
        </div>

        <p className="text-[12.5px] text-[var(--l-ash)]">
          By continuing you agree to use the service for lawful purposes. Data is stored in the EU.
        </p>
      </div>
    </div>
  );
}

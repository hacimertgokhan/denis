"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/app/brand-icons";
import { AuthAtmosphere } from "@/components/landing/atmosphere";
import { authClient } from "@/lib/auth-client";

const field =
  "h-11 w-full rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 text-[15px] text-[var(--l-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--l-ash)]/70 focus:border-[var(--l-ink)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--l-ash)_25%,transparent)]";

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
    if (mode === "register" && form.get("consent") !== "on") {
      setBusy(false);
      toast.error("Please accept the Terms of Service and the Privacy Policy");
      return;
    }
    const result =
      mode === "register"
        ? await authClient.signUp.email({
            email,
            password,
            name: name || email.split("@")[0],
          })
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
      {/* left: atmosphere and a short promise */}
      <aside className="hidden lg:block">
        <AuthAtmosphere>
          <div className="-mt-10 flex min-h-[calc(100vh-10rem)] flex-col justify-between">
            <span />
            <div className="max-w-[30rem]">
              <p className="text-[2rem] leading-[1.2] font-medium tracking-[-0.015em] text-balance text-white">
                Keys, small tables and an MCP endpoint, one line at a time.
              </p>
              <ul className="mt-8 grid gap-3 text-[15px] text-white/70">
                <li className="flex gap-3">
                  <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-[var(--l-ash)]" /> Three databases per account, each with its own API keys.
                </li>
                <li className="flex gap-3">
                  <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-[var(--l-ash)]" /> A web console, a REST API and a hosted MCP endpoint.
                </li>
                <li className="flex gap-3">
                  <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-[var(--l-ash)]" /> Every change journaled to disk the moment it is
                  acknowledged.
                </li>
              </ul>
            </div>
            <p className="text-[13px] text-white/45">Open source engine, MIT licensed. Free hosting.</p>
          </div>
        </AuthAtmosphere>
      </aside>

      {/* right: the form */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-end">
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
          <p className="mt-2 text-[15px] text-[var(--l-ash)]">{mode === "login" ? "Pick up where you left off." : "Your first database is a minute away."}</p>

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
            {mode === "register" && (
              <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[var(--l-ash)]">
                <input name="consent" type="checkbox" required className="mt-1 size-3.5 accent-[var(--l-ink)]" />
                <span>
                  I have read the{" "}
                  <Link href="/terms" className="underline decoration-[var(--l-line)] underline-offset-4 hover:text-[var(--l-ink)]" target="_blank">
                    Terms of Service
                  </Link>{" "}
                  and the{" "}
                  <Link href="/privacy" className="underline decoration-[var(--l-line)] underline-offset-4 hover:text-[var(--l-ink)]" target="_blank">
                    Privacy Policy
                  </Link>
                  , and I agree to my account data being processed as described there.
                </span>
              </label>
            )}
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
                  onClick={() =>
                    authClient.signIn.social({
                      provider: "github",
                      callbackURL: next,
                    })
                  }
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--l-line)] bg-[var(--card)] text-[15px] font-medium transition-colors hover:border-[var(--l-ink)]"
                >
                  <GitHubIcon className="size-4" /> Continue with GitHub
                </button>
              </>
            )}
          </form>
        </div>

        <p className="text-[12.5px] text-[var(--l-ash)]">By continuing you agree to use the service for lawful purposes. Data is stored in the EU.</p>
      </div>
    </div>
  );
}

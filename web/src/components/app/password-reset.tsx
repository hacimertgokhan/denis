"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { HumanCheck, useHumanCheck } from "@/components/app/human-check";
import { authClient } from "@/lib/auth-client";

const field =
  "h-11 w-full rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 text-[15px] text-[var(--l-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--l-ash)]/70 focus:border-[var(--l-ink)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--l-ash)_25%,transparent)]";
const button =
  "mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-ink)] text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90 disabled:opacity-60";

/** One centred card on paper; the auth pages' split layout would be too much for two fields. */
function Shell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="landing flex min-h-screen flex-col px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between text-[14px] text-[var(--l-ash)]">
        <Link href="/" className="hover:text-[var(--l-ink)]">
          ← Home
        </Link>
        <Link href="/login" className="hover:text-[var(--l-ink)]">
          Sign in
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
        <h1 className="text-[1.75rem] leading-tight font-medium tracking-[-0.01em]">{title}</h1>
        <p className="mt-2 text-[15px] text-[var(--l-ash)]">{lead}</p>
        {children}
      </div>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const human = useHumanCheck();

  async function submit(form: FormData) {
    const email = String(form.get("email") ?? "").trim();
    setBusy(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password", fetchOptions: { headers: human.headers() } });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "That did not work. Please try again.");
      return;
    }
    // the same answer whether or not the address exists: no account enumeration
    setSent(email);
  }

  if (sent) {
    return (
      <Shell title="Check your inbox" lead={`If an account exists for ${sent}, a link to choose a new password is on its way. It works for one hour.`}>
        <p className="mt-6 text-[13.5px] text-[var(--l-ash)]">
          Nothing there after a few minutes? Look in spam, or{" "}
          <button type="button" onClick={() => setSent(null)} className="underline decoration-[var(--l-line)] underline-offset-4 hover:text-[var(--l-ink)]">
            try again
          </button>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Forgot your password?" lead="Enter the email of your account and we will send you a link to choose a new one.">
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <label className="grid gap-1.5 text-[13.5px] font-medium">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} autoFocus />
        </label>
        <HumanCheck check={human} />
        <button type="submit" disabled={busy || !human.ready} className={button}>
          {busy && <Loader2Icon className="size-4 animate-spin" />} Send reset link
        </button>
      </form>
    </Shell>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const invalid = params.get("error") === "INVALID_TOKEN" || !token;
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      toast.error("The two passwords do not match");
      return;
    }
    setBusy(true);
    const result = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "This link is no longer valid. Request a new one.");
      return;
    }
    toast.success("Password changed. Sign in with the new one.");
    router.push("/login");
  }

  if (invalid) {
    return (
      <Shell title="This link is not valid" lead="Reset links work once and expire after an hour.">
        <Link href="/forgot-password" className={button + " mt-6"}>
          Request a new link
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password" lead="At least 8 characters. Your other sessions are signed out afterwards.">
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <label className="grid gap-1.5 text-[13.5px] font-medium">
          New password
          <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={field} autoFocus />
        </label>
        <label className="grid gap-1.5 text-[13.5px] font-medium">
          Repeat it
          <input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className={field} />
        </label>
        <button type="submit" disabled={busy} className={button}>
          {busy && <Loader2Icon className="size-4 animate-spin" />} Change password
        </button>
      </form>
    </Shell>
  );
}

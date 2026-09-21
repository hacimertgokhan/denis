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
const codeField = field + " text-center font-mono text-[22px] tracking-[0.4em]";
const button =
  "mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-ink)] text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90 disabled:opacity-60";
const quiet = "text-[13.5px] text-[var(--l-ash)] underline decoration-[var(--l-line)] underline-offset-4 hover:text-[var(--l-ink)]";

function Shell({ title, lead, children }: { title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="landing flex min-h-screen flex-col px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between text-[14px] text-[var(--l-ash)]">
        <Link href="/" className="hover:text-[var(--l-ink)]">
          ← Home
        </Link>
        <Link href="/login" className="hover:text-[var(--l-ink)]">
          Sign in with a password
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

function CodeInput({ name = "otp" }: { name?: string }) {
  return (
    <label className="grid gap-1.5 text-[13.5px] font-medium">
      Six-digit code
      <input
        name={name}
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoComplete="one-time-code"
        placeholder="••••••"
        className={codeField}
        autoFocus
      />
    </label>
  );
}

/** After sign-up: the code from the mail confirms the address. Also reachable from the banner in the app. */
export function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const next = params.get("next") || "/dashboard";
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const human = useHumanCheck();

  async function verify(form: FormData) {
    setBusy(true);
    const result = await authClient.emailOtp.verifyEmail({ email, otp: String(form.get("otp") ?? "") });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "That code did not work.");
      return;
    }
    toast.success("Email confirmed");
    router.push(next);
    router.refresh();
  }

  async function resend() {
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification", fetchOptions: { headers: human.headers() } });
    if (result.error) toast.error(result.error.message ?? "Could not send a new code.");
    else setResent(true);
  }

  if (!email) {
    return (
      <Shell title="Confirm your email" lead="Open this page from the link in the application, or sign in first.">
        <Link href="/login" className={button + " mt-6"}>
          Sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell
      title="Confirm your email"
      lead={
        <>
          We sent a six-digit code to <span className="font-medium text-[var(--l-ink)]">{email}</span>. It expires in ten minutes.
        </>
      }
    >
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(new FormData(e.currentTarget));
        }}
      >
        <CodeInput />
        <HumanCheck check={human} />
        <button type="submit" disabled={busy} className={button}>
          {busy && <Loader2Icon className="size-4 animate-spin" />} Confirm
        </button>
      </form>
      <p className="mt-6 text-[13.5px] text-[var(--l-ash)]">
        {resent ? (
          "A new code is on its way."
        ) : (
          <>
            Nothing arrived?{" "}
            <button type="button" onClick={() => void resend()} className={quiet}>
              Send a new code
            </button>
            .
          </>
        )}
      </p>
    </Shell>
  );
}

/** Password-less sign-in: an address, then the code from the mail. */
export function SignInWithCodeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const human = useHumanCheck();

  async function send(form: FormData) {
    const address = String(form.get("email") ?? "").trim();
    setBusy(true);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: address, type: "sign-in", fetchOptions: { headers: human.headers() } });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "Could not send a code.");
      return;
    }
    setEmail(address);
    setSent(true);
  }

  async function signIn(form: FormData) {
    setBusy(true);
    const result = await authClient.signIn.emailOtp({ email, otp: String(form.get("otp") ?? "") });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "That code did not work.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  if (sent) {
    return (
      <Shell
        title="Enter your code"
        lead={
          <>
            If <span className="font-medium text-[var(--l-ink)]">{email}</span> has an account, a six-digit code is on its way. It expires in ten minutes.
          </>
        }
      >
        <form
          className="mt-8 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(new FormData(e.currentTarget));
          }}
        >
          <CodeInput />
          <button type="submit" disabled={busy} className={button}>
            {busy && <Loader2Icon className="size-4 animate-spin" />} Sign in
          </button>
        </form>
        <p className="mt-6 text-[13.5px] text-[var(--l-ash)]">
          Wrong address?{" "}
          <button type="button" onClick={() => setSent(false)} className={quiet}>
            Start over
          </button>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Sign in with a code" lead="No password needed: we email you a six-digit code that works once.">
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(new FormData(e.currentTarget));
        }}
      >
        <label className="grid gap-1.5 text-[13.5px] font-medium">
          Email
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} autoFocus />
        </label>
        <HumanCheck check={human} />
        <button type="submit" disabled={busy || !human.ready} className={button}>
          {busy && <Loader2Icon className="size-4 animate-spin" />} Email me a code
        </button>
      </form>
      <p className="mt-6 text-[13.5px] text-[var(--l-ash)]">
        New here?{" "}
        <Link href="/register" className={quiet}>
          Create an account
        </Link>{" "}
        first; codes only sign in existing accounts.
      </p>
    </Shell>
  );
}

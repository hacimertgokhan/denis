"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionRow } from "@/components/app/page-primitives";
import { authClient } from "@/lib/auth-client";

const field =
  "h-11 w-full rounded-md border border-[var(--l-line)] bg-[var(--card)] px-3.5 text-[15px] text-[var(--l-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--l-ash)]/70 focus:border-[var(--l-ink)] focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--l-ash)_25%,transparent)]";
const button =
  "mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-ink)] text-[15px] font-medium text-[var(--l-bg)] transition-opacity hover:opacity-90 disabled:opacity-60";
const quiet = "text-[13.5px] text-[var(--l-ash)] underline decoration-[var(--l-line)] underline-offset-4 hover:text-[var(--l-ink)]";

/** The second step of a password sign-in for accounts with the email code on. */
export function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [sent, setSent] = useState<"sending" | "sent" | "failed">("sending");
  const [busy, setBusy] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await authClient.twoFactor.sendOtp();
      setSent(r.error ? "failed" : "sent");
      if (r.error) toast.error(r.error.message ?? "Could not send the code.");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function submit(form: FormData) {
    const code = String(form.get("code") ?? "").trim();
    setBusy(true);
    const r = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: true })
      : await authClient.twoFactor.verifyOtp({ code, trustDevice: true });
    setBusy(false);
    if (r.error) {
      toast.error(r.error.message ?? "That code did not work.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="landing flex min-h-screen flex-col px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between text-[14px] text-[var(--l-ash)]">
        <Link href="/" className="hover:text-[var(--l-ink)]">
          ← Home
        </Link>
        <Link href="/login" className="hover:text-[var(--l-ink)]">
          Start over
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
        <h1 className="text-[1.75rem] leading-tight font-medium tracking-[-0.01em]">One more step</h1>
        <p className="mt-2 text-[15px] text-[var(--l-ash)]">
          {useBackup
            ? "Enter one of the backup codes you saved when you turned the sign-in code on. Each works once."
            : sent === "sent"
              ? "We emailed a six-digit code to the address of this account. It expires in ten minutes."
              : sent === "failed"
                ? "The code could not be sent. Try again in a moment, or use a backup code."
                : "Sending a code to your email…"}
        </p>
        <form
          className="mt-8 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(new FormData(e.currentTarget));
          }}
        >
          <label className="grid gap-1.5 text-[13.5px] font-medium">
            {useBackup ? "Backup code" : "Six-digit code"}
            <input
              name="code"
              inputMode={useBackup ? "text" : "numeric"}
              maxLength={useBackup ? 16 : 6}
              required
              autoComplete="one-time-code"
              placeholder={useBackup ? "xxxxx-xxxxx" : "••••••"}
              className={field + " text-center font-mono text-[20px] tracking-[0.3em]"}
              autoFocus
            />
          </label>
          <button type="submit" disabled={busy} className={button}>
            {busy && <Loader2Icon className="size-4 animate-spin" />} Continue
          </button>
        </form>
        <p className="mt-6 text-[13.5px] text-[var(--l-ash)]">
          {useBackup ? (
            <button type="button" onClick={() => setUseBackup(false)} className={quiet}>
              Use the emailed code instead
            </button>
          ) : (
            <>
              No email?{" "}
              <button
                type="button"
                onClick={async () => {
                  const r = await authClient.twoFactor.sendOtp();
                  if (r.error) toast.error(r.error.message ?? "Could not send the code.");
                  else toast.success("A new code is on its way");
                }}
                className={quiet}
              >
                Send again
              </button>{" "}
              or{" "}
              <button type="button" onClick={() => setUseBackup(true)} className={quiet}>
                use a backup code
              </button>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Settings -> Security: turn the emailed sign-in code on or off; backup codes are shown once. */
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<"enable" | "disable" | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function submit() {
    setBusy(true);
    try {
      if (open === "enable") {
        // the default (totp) enrolment stores the secret row and issues backup codes;
        // the authenticator URI is never shown, sign-in uses the emailed code
        const r = await authClient.twoFactor.enable({ password });
        if (r.error) throw new Error(r.error.message ?? "Could not turn it on");
        setCodes(r.data && "backupCodes" in r.data ? r.data.backupCodes : []);
        toast.success("Sign-in code is on");
      } else {
        const r = await authClient.twoFactor.disable({ password });
        if (r.error) throw new Error(r.error.message ?? "Could not turn it off");
        toast.success("Sign-in code is off");
      }
      setOpen(null);
      setPassword("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionRow
        title="Sign-in code"
        description="With this on, a password alone is not enough: every sign-in from a new browser also needs a six-digit code from your email."
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[14px]">
            <ShieldCheckIcon className={enabled ? "size-4" : "text-muted-foreground size-4"} />
            {enabled ? "On" : "Off"}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOpen(enabled ? "disable" : "enable")}>
            {enabled ? "Turn off…" : "Turn on…"}
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 max-w-[60ch] text-[12.5px] leading-relaxed">
          You also get an email whenever a new browser signs in to the account, whether or not this is on.
        </p>
      </SectionRow>

      <Dialog open={open !== null} onOpenChange={(o) => !busy && !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{open === "enable" ? "Turn the sign-in code on" : "Turn the sign-in code off"}</DialogTitle>
            <DialogDescription>Confirm with your password.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="tf-pass">Password</Label>
            <Input id="tf-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy || password.length < 8}>
              {busy && <Loader2Icon className="animate-spin" />} {open === "enable" ? "Turn on" : "Turn off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={codes !== null} onOpenChange={(o) => !o && setCodes(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Backup codes</DialogTitle>
            <DialogDescription>
              If you ever cannot receive email, one of these signs you in instead of the code. Each works once. They are shown now and never again; keep them
              somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border px-4 py-3 font-mono text-[13.5px]">
            {(codes ?? []).map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText((codes ?? []).join("\n"));
                toast.success("Copied");
              }}
            >
              <CopyIcon /> Copy
            </Button>
            <Button onClick={() => setCodes(null)}>I saved them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

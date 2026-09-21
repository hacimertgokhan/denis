"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionRow } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";

/** The account's rights over its data: a full export and permanent deletion. */
export function AccountData({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await apiFetch("/api/v1/me", { method: "DELETE", body: JSON.stringify({ confirm }) });
      toast.success("Your account has been deleted");
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <SectionRow
        title="Your data"
        description="Download everything the platform stores about you, or delete the account. Database contents are yours to export from the console or the API."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/v1/me/export" download>
              <DownloadIcon /> Download my data (JSON)
            </a>
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 max-w-[60ch] text-[12.5px] leading-relaxed">
          What is stored, why, and for how long is described in the{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          . Requests that need a person (correction, objection, a question about processing) go to the contact address listed there.
        </p>
      </SectionRow>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Every database you own is dropped from the engine together with its keys, tables, API keys, members and database accounts. Databases shared with
              you stay with their owners. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-email">
              Type <span className="font-mono">{email}</span> to confirm
            </Label>
            <Input id="confirm-email" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || confirm.trim().toLowerCase() !== email.toLowerCase()} onClick={() => void remove()}>
              {busy && <Loader2Icon className="animate-spin" />} Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

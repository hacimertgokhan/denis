"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionRow } from "@/components/app/page-primitives";
import { apiFetch } from "@/lib/client-api";

export function MailPreferences({ optIn, verified, email }: { optIn: boolean; verified: boolean; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(optIn);

  async function change(next: boolean) {
    setValue(next);
    try {
      await apiFetch("/api/v1/me", { method: "PATCH", body: JSON.stringify({ marketingOptIn: next }) });
      toast.success(next ? "Product updates on" : "Product updates off");
      router.refresh();
    } catch (err) {
      setValue(!next);
      toast.error((err as Error).message);
    }
  }

  return (
    <SectionRow title="Email" description="Codes and password resets always arrive; product updates only if you want them.">
      <div className="grid gap-3 text-[14px]">
        <div className="text-muted-foreground">
          <span className="text-foreground">{email}</span>
          {verified ? (
            " · confirmed"
          ) : (
            <>
              {" "}
              · not confirmed yet —{" "}
              <Link href={`/verify-email?email=${encodeURIComponent(email)}`} className="underline underline-offset-4">
                enter the code
              </Link>
            </>
          )}
        </div>
        <label className="flex items-start gap-2.5">
          <Checkbox checked={value} onCheckedChange={(c) => void change(c === true)} className="mt-0.5" />
          <span>
            Product updates by email
            <span className="text-muted-foreground block text-[12.5px]">A few messages a year about new releases. Every one has an unsubscribe link.</span>
          </span>
        </label>
      </div>
    </SectionRow>
  );
}

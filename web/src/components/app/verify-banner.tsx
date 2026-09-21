import Link from "next/link";
import { MailIcon } from "lucide-react";

/** Shown at the top of the workbench until the sign-up code has been entered. */
export function VerifyBanner({ email }: { email: string }) {
  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-[13px] lg:px-8">
      <MailIcon className="text-muted-foreground size-3.5" />
      <span>
        Confirm <span className="font-medium">{email}</span> with the code we sent you.
      </span>
      <Link href={`/verify-email?email=${encodeURIComponent(email)}`} className="underline underline-offset-4">
        Enter the code
      </Link>
    </div>
  );
}

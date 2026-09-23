import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/app/email-code";

export const metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}

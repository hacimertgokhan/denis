import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/app/password-reset";

export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

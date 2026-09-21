import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/app/password-reset";

export const metadata = { title: "Forgot your password", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}

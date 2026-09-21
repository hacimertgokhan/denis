import { Suspense } from "react";
import { SignInWithCodeForm } from "@/components/app/email-code";

export const metadata = {
  title: "Sign in with a code",
  description: "Sign in to Denis Cloud with a one-time code sent to your email.",
  alternates: { canonical: "/login/code" },
};

export default function Page() {
  return (
    <Suspense>
      <SignInWithCodeForm />
    </Suspense>
  );
}

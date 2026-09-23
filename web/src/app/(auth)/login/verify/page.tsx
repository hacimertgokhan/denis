import { Suspense } from "react";
import { TwoFactorForm } from "@/components/app/two-factor";

export const metadata = { title: "One more step", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}

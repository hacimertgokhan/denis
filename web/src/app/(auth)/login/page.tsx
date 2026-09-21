import { Suspense } from "react";
import { AuthForm } from "@/components/app/auth-form";
import { env } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default function Page() {
  const e = env();
  return (
    <Suspense>
      <AuthForm mode="login" githubEnabled={Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET)} />
    </Suspense>
  );
}

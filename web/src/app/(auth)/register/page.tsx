import { Suspense } from "react";
import { AuthForm } from "@/components/app/auth-form";
import { env } from "@/lib/env";

export const metadata = {
  title: "Create a free account",
  description: "Create a Denis Cloud account: three hosted databases with a console, API keys and an MCP endpoint, free.",
  alternates: { canonical: "/register" },
};

export default function Page() {
  const e = env();
  return (
    <Suspense>
      <AuthForm mode="register" githubEnabled={Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET)} />
    </Suspense>
  );
}

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "0.5.0";

/** Reading layout for the legal and policy pages: one measure of prose, hairline sections. */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="landing min-h-screen font-sans text-[var(--l-ink)]">
      <LandingNav signedIn={Boolean(user)} />
      <main className="mx-auto max-w-[1560px] px-6 pt-28 pb-24 lg:px-10">
        <article className="legal max-w-[72ch]">{children}</article>
      </main>
      <LandingFooter version={ENGINE_VERSION} />
    </div>
  );
}

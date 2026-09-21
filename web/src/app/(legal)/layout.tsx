import { LandingFooter } from "@/components/landing/footer";
import { LegalToc } from "@/components/landing/legal-toc";
import { LandingNav } from "@/components/landing/nav";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "0.6.1";

/** Reading layout for the policy pages: a sticky outline on the left, the text across the rest of the column. */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="landing min-h-screen font-sans text-[var(--l-ink)]">
      <LandingNav signedIn={Boolean(user)} />
      <main className="mx-auto max-w-[1560px] px-6 pt-28 pb-24 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[15rem_1fr] lg:gap-16">
          <aside className="order-last lg:order-none">
            <div className="lg:sticky lg:top-28">
              <LegalToc />
            </div>
          </aside>
          <article className="legal min-w-0">{children}</article>
        </div>
      </main>
      <LandingFooter version={ENGINE_VERSION} />
    </div>
  );
}

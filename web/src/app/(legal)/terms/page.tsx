import type { Metadata } from "next";
import Link from "next/link";
import { env, plan } from "@/lib/env";
import { formatBytes, formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement between you and Denis Cloud: what the service is, what you may do with it, limits, availability and liability.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "21 September 2026";

export default function TermsPage() {
  const e = env();
  const limits = plan();
  return (
    <>
      <p className="text-[13px] text-[var(--l-ash)]">Last updated {UPDATED}</p>
      <h1>Terms of Service</h1>
      <p className="lead">
        These terms are the agreement between you and {e.LEGAL_ENTITY} (&quot;we&quot;) for the use of Denis Cloud at denis.hacimertgokhan.com. By creating an
        account you accept them. They are short on purpose; the <Link href="/privacy">Privacy Policy</Link> covers personal data and the{" "}
        <Link href="/security">security page</Link> covers how the service is protected.
      </p>

      <h2>1. The service</h2>
      <p>
        Denis Cloud hosts databases running the open-source Denis engine and gives you a web console, a REST API, a Node.js client and an MCP endpoint to use
        them. The engine is MIT-licensed and you may run it yourself at any time; these terms only cover the hosted service.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be 16 or older and give a working email address. Keep your password and API keys secret; what is done with them counts as done by you.</li>
        <li>
          One person, one account. You may share a database with other accounts and create database accounts for people or systems; you are responsible for what
          they do in it.
        </li>
        <li>Tell us at once if you believe a credential has leaked. Revoking an API key or changing a password takes effect immediately.</li>
      </ul>

      <h2>3. The free plan and its limits</h2>
      <p>
        Every account currently gets, free of charge: {limits.maxDatabases} databases, each with {formatBytes(limits.dbMaxBytes)} of storage,{" "}
        {formatNumber(limits.dbMaxKeys)} keys and {formatNumber(limits.dbOpsPerDay)} commands per day, and {formatNumber(limits.apiRatePerMinute)} API requests
        per minute per key. The engine and the gateway enforce these limits; a command over the limit is refused with a clear error rather than silently
        dropped. We may change the limits of the free plan with 30 days&apos; notice by email, and may offer paid plans later. Nothing you have stored is
        deleted because of a limit change.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use the service to:</p>
      <ul>
        <li>store or distribute content that is illegal where you or we are, that infringes others&apos; rights, or that you have no right to process;</li>
        <li>attack the service or other users: probing, scanning, circumventing quotas or isolation, denial of service, credential stuffing;</li>
        <li>
          store personal data of others without a lawful basis, or special-category data (health, biometrics, beliefs) at all — the free plan is not certified
          for it;
        </li>
        <li>run cryptocurrency mining, spam, or anything that consumes the shared engine far beyond a normal application;</li>
        <li>resell the service or present it as your own.</li>
      </ul>
      <p>
        If you want to test the security of the service, read the <Link href="/security">responsible disclosure</Link> terms first; testing within them is
        welcome and not a breach.
      </p>

      <h2>5. Your data</h2>
      <p>
        What you store stays yours. We do not read database contents except as needed to run the service (backups, migrations, investigating an abuse report or
        an outage), and we act as your processor for any personal data in them. You can export or delete your data at any time from Settings; the{" "}
        <Link href="/privacy">Privacy Policy</Link> lists what we keep and for how long.
      </p>

      <h2>6. Availability and changes</h2>
      <p>
        The service is provided as it is, without a guaranteed uptime. We do keep every acknowledged write in a journal, sample usage hourly and run backups,
        but a free service can have outages, maintenance windows and breaking changes. Where we can, we announce them in the application (the Updates panel) at
        least 14 days ahead. If we ever shut the service down we give 60 days&apos; notice and keep exports available until the end.
      </p>

      <h2>7. Suspension and termination</h2>
      <p>
        You can delete your account whenever you like. We may suspend an account that breaches section 4, endangers other users, or has not been used for 12
        months (after an email warning); a suspended account can still export its data for 30 days. We may terminate accounts for repeated or serious breaches.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect damage, lost profits or lost data resulting from use of a free service, and our total
        liability for any claim is limited to EUR 100. Nothing here limits liability for intent, gross negligence, or where consumer law says otherwise — in
        particular your statutory rights under Turkish and EU consumer law are unaffected.
      </p>

      <h2>9. Governing law</h2>
      <p>
        Turkish law applies; the courts of Türkiye have jurisdiction, without prejudice to the mandatory consumer protection rules and forums of the country you
        live in.
      </p>

      <h2>10. Contact and changes to these terms</h2>
      <p>
        Questions: <a href={`mailto:${e.LEGAL_CONTACT_EMAIL}`}>{e.LEGAL_CONTACT_EMAIL}</a>. When these terms change materially we email account holders and show
        a notice in the application 14 days before the change applies; continuing to use the service afterwards means accepting the new terms.
      </p>
    </>
  );
}

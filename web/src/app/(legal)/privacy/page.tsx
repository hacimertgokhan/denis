import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Denis Cloud stores about you, why, for how long, and how to exercise your rights under the GDPR.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "21 September 2026";

export default function PrivacyPage() {
  const e = env();
  return (
    <>
      <p className="text-[13px] text-[var(--l-ash)]">Last updated {UPDATED}</p>
      <h1>Privacy Policy</h1>
      <p className="lead">
        Denis Cloud is a hosted database service. This page says exactly what we store about you, why, for how long, and how you exercise your rights. It
        follows the EU General Data Protection Regulation (GDPR) and applies to every user, wherever they are.
      </p>

      <h2>1. Who is responsible</h2>
      <p>
        The data controller is <strong>{e.LEGAL_ENTITY}</strong>
        {e.LEGAL_ADDRESS ? `, ${e.LEGAL_ADDRESS}` : ""}. Contact for anything in this
        policy: <a href={`mailto:${e.LEGAL_CONTACT_EMAIL}`}>{e.LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>2. What we store, and why</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Purpose</th>
            <th>Legal basis</th>
            <th>Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Name, email address, password hash (or the identity returned by GitHub if you sign in that way)</td>
            <td>Your account: signing in, showing who did what, contacting you about the service</td>
            <td>Contract (GDPR art. 6(1)(b))</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>Session records: a random token, IP address, browser user agent, timestamps</td>
            <td>Keeping you signed in; spotting stolen sessions</td>
            <td>Contract; legitimate interest in security (GDPR art. 6(1)(f))</td>
            <td>30 days after the last use, or until you sign out</td>
          </tr>
          <tr>
            <td>Databases you create: name, region, limits, usage counters, the engine project token</td>
            <td>Providing the service and enforcing the quotas you agreed to</td>
            <td>Contract</td>
            <td>Until you delete the database or the account</td>
          </tr>
          <tr>
            <td>The contents of your databases (keys, values, tables)</td>
            <td>Stored and returned on your instructions only. You decide what goes in; we do not read it except to operate the service</td>
            <td>
              Contract; you are the controller of any personal data you put there and we act as your processor (GDPR art. 28)
            </td>
            <td>Until you delete it; at most 30 days in backups afterwards</td>
          </tr>
          <tr>
            <td>API keys (hashed), members, database accounts (hashed passwords)</td>
            <td>Letting applications, teammates and AI assistants use a database with the access you chose</td>
            <td>Contract</td>
            <td>Until revoked or the database is deleted</td>
          </tr>
          <tr>
            <td>Command history: the command text, who ran it, the result and latency</td>
            <td>Letting you audit what happened in your database; abuse detection</td>
            <td>Legitimate interest (security, accountability); shown to the database&apos;s owner, admins, editors and viewers</td>
            <td>30 days, then deleted automatically. Sign-in lines are never stored</td>
          </tr>
          <tr>
            <td>Audit log: account and database events (created, deleted, shared, suspended)</td>
            <td>Support and accountability</td>
            <td>Legitimate interest</td>
            <td>12 months</td>
          </tr>
          <tr>
            <td>Request logs on the server: IP address, path, status, timing</td>
            <td>Keeping the service up; rate limiting; investigating attacks</td>
            <td>Legitimate interest</td>
            <td>14 days</td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not run advertising, analytics or tracking scripts, we do not sell data, and we do not build profiles. Nothing on these pages loads from a third
        party except your GitHub avatar if you chose GitHub sign-in.
      </p>

      <h2>3. Cookies</h2>
      <p>
        Only strictly necessary cookies are set: the session cookie after you sign in, a cookie per database when you sign in to a database&apos;s own login
        page, and a theme preference kept in your browser&apos;s local storage. None of them is used to track you across sites, so no consent banner is needed.
        Details are on the <Link href="/cookies">cookie page</Link>.
      </p>

      <h2>4. Who else sees the data</h2>
      <p>
        Processors that host the service: the server provider that runs the engine, the web app and the PostgreSQL database that holds account data (all in the
        same data centre region), and GitHub if you sign in with GitHub (only your public profile and email are received). Each processor is bound by a data
        processing agreement. We disclose data to authorities only when the law requires it, and we tell you unless that is prohibited.
      </p>

      <h2>5. Where the data lives</h2>
      <p>
        Account data and database contents are stored in the region shown on the database (<code>eu-central</code> at the moment). If we ever transfer data
        outside the European Economic Area, we rely on the European Commission&apos;s standard contractual clauses or an adequacy decision, and update this
        page first.
      </p>

      <h2>6. How we protect it</h2>
      <p>
        TLS everywhere, passwords hashed with scrypt, API keys stored only as SHA-256 hashes and shown once, per-database isolation inside the engine, rate
        limits on sign-in and on the API, security headers and a content security policy, and access to production limited to the operator. The{" "}
        <Link href="/security">security page</Link> goes into detail and explains how to report a vulnerability.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Under the GDPR (articles 15 to 22) you can ask what we hold about you, get a copy, have it corrected or deleted, restrict or object to processing,
        take your data elsewhere, and complain to the data protection authority of your country. Two of these you can do yourself, right now:
      </p>
      <ul>
        <li>
          <strong>Export</strong>: Settings → Your data → Download my data gives you a JSON file with everything in the table above that belongs to you.
        </li>
        <li>
          <strong>Delete</strong>: Settings → Your data → Delete account removes the account, every database you own, its API keys, members, database accounts
          and sessions immediately; backups expire within 30 days.
        </li>
      </ul>
      <p>
        For anything else write to <a href={`mailto:${e.LEGAL_CONTACT_EMAIL}`}>{e.LEGAL_CONTACT_EMAIL}</a> from the address on your account. We answer within
        one month, as the GDPR requires, and aim for a few days. No fee is charged.
      </p>

      <h2>8. Children</h2>
      <p>The service is not directed at children under 16 and we do not knowingly create accounts for them.</p>

      <h2>9. Changes</h2>
      <p>
        When this policy changes in a way that matters, the date at the top moves and signed-in users see a notice in the application before the change takes
        effect. Earlier versions are available on request.
      </p>
    </>
  );
}

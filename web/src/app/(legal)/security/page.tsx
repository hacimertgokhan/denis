import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Security",
  description: "How Denis Cloud protects accounts and databases, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  const e = env();
  return (
    <>
      <h1>Security</h1>
      <p className="lead">What protects your account and your databases, stated plainly, and how to tell us when something is wrong.</p>

      <h2>Isolation</h2>
      <ul>
        <li>
          Every database is a separate project inside the engine with its own token. The platform is the engine&apos;s only client; the engine port is never
          reachable from the internet.
        </li>
        <li>
          A request reaches a database only through the gateway, which checks who you are (session, database account or API key), what role you have, whether
          the key may write, and how much of the daily budget is left — on every request, from the database, never from a cached claim.
        </li>
        <li>Roles are owner, admin, editor and viewer; the UI hides what the server refuses anyway.</li>
      </ul>

      <h2>Credentials</h2>
      <ul>
        <li>Passwords are hashed with scrypt (N=16384) and a per-account salt; the platform never sees or logs a plain password after sign-up.</li>
        <li>
          API keys are shown once and stored as SHA-256 hashes. Keys can be read-only. Revoking a key also invalidates every access and refresh token issued
          from it.
        </li>
        <li>
          Access tokens are HS256 JWTs that expire after 15 minutes; refresh tokens after 30 days; database-account sessions after 12 hours. Cookies are
          httpOnly, SameSite=Lax and secure.
        </li>
        <li>Sign-in, database sign-in and token exchange are rate limited per address and per account, so a password cannot be guessed online.</li>
      </ul>

      <h2>Transport and browser</h2>
      <ul>
        <li>
          TLS 1.2+ with HSTS. Every response carries a Content Security Policy that only allows the site&apos;s own scripts and styles, forbids framing and
          plugins, and pins form targets to the site.
        </li>
        <li>
          State-changing API requests from another origin are refused before any handler runs, and JSON bodies are required (no form-encoded or text/plain
          smuggling).
        </li>
        <li>No third-party scripts, analytics or fonts are loaded.</li>
      </ul>

      <h2>Data</h2>
      <ul>
        <li>Every acknowledged write is appended to a journal and fsynced within one second; a snapshot replaces the journal every thirty seconds.</li>
        <li>Quotas (storage, keys, commands) are enforced by the engine and the gateway so that one tenant cannot starve another.</li>
        <li>Command history stores commands for 30 days for the database&apos;s own members; sign-in lines are redacted before they are stored.</li>
        <li>
          You can export or delete everything from Settings at any time; see the <Link href="/privacy">Privacy Policy</Link>.
        </li>
      </ul>

      <h2>Operations</h2>
      <ul>
        <li>Production access is limited to the operator with hardware-backed keys. Secrets live in the environment, never in the repository.</li>
        <li>Dependencies are updated through automated alerts; the engine and the platform are open source, so anyone can review what runs.</li>
        <li>Backups are encrypted at rest and expire after 30 days.</li>
      </ul>

      <h2>Reporting a vulnerability</h2>
      <p>
        If you find a weakness, write to <a href={`mailto:${e.LEGAL_CONTACT_EMAIL}`}>{e.LEGAL_CONTACT_EMAIL}</a> with the steps to reproduce it. We confirm
        receipt within two working days, keep you informed, credit you if you wish, and do not take legal action against good-faith research that:
      </p>
      <ul>
        <li>only touches accounts and databases you created yourself;</li>
        <li>does not degrade the service for others (no denial of service, no mass scanning, no spam);</li>
        <li>does not access, change or delete other users&apos; data — if you stumble on it, stop and report;</li>
        <li>gives us a reasonable time to fix the issue before it is published.</li>
      </ul>
      <p>
        Security-relevant changes are listed in the project&apos;s{" "}
        <a href="https://github.com/hacimertgokhan/denis/blob/master/CHANGELOG.md" target="_blank" rel="noreferrer">
          changelog
        </a>
        .
      </p>
    </>
  );
}

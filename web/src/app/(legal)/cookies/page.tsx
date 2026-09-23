import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookies",
  description: "The three things Denis Cloud keeps in your browser, all of them necessary, none of them tracking.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <>
      <h1>Cookies</h1>
      <p className="lead">
        Denis Cloud sets no advertising, analytics or third-party cookies. The items below are strictly necessary for the service to work, which is why there is
        no consent banner: the ePrivacy Directive (art. 5(3)) exempts them.
      </p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>What it does</th>
            <th>Lifetime</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>better-auth.session_token</code>
            </td>
            <td>Keeps you signed in to the platform. httpOnly, SameSite=Lax, secure.</td>
            <td>30 days, renewed daily while you use the service; removed on sign-out</td>
          </tr>
          <tr>
            <td>
              <code>denis_db_&lt;id&gt;</code>
            </td>
            <td>Keeps a database account signed in to that one database&apos;s workspace. One per database, httpOnly, SameSite=Lax, secure.</td>
            <td>12 hours; removed on sign-out</td>
          </tr>
          <tr>
            <td>
              <code>theme</code> (local storage, not a cookie)
            </td>
            <td>Remembers whether you chose light or dark mode. Never sent to the server.</td>
            <td>Until you clear site data</td>
          </tr>
        </tbody>
      </table>
      <p>
        Blocking these in your browser means you cannot stay signed in. Everything else about your data is in the <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </>
  );
}

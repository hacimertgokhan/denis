import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/lib/env";

/**
 * Outgoing mail. Providers in order of preference: Resend (RESEND_API_KEY),
 * SMTP (SMTP_URL), and otherwise the server log, which is what a developer
 * wants locally. Every message is built by one template so they all look
 * like they come from the same place: a wordmark, the text, and a footer
 * that says who sent it and why.
 *
 * Transactional messages (codes, reset links) carry no unsubscribe link;
 * they are part of the service. Announcements do, plus List-Unsubscribe
 * headers so mail clients show their own button.
 */
export type Message = {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  /** Marks announcements: adds List-Unsubscribe headers. */
  unsubscribeUrl?: string;
};

let resend: Resend | null | undefined;
let smtp: nodemailer.Transporter | null | undefined;

function providers() {
  const e = env();
  if (resend === undefined) resend = e.RESEND_API_KEY ? new Resend(e.RESEND_API_KEY) : null;
  if (smtp === undefined) smtp = e.SMTP_URL ? nodemailer.createTransport(e.SMTP_URL) : null;
  return { resend, smtp, from: e.MAIL_FROM };
}

export function mailConfigured() {
  const p = providers();
  return Boolean(p.resend || p.smtp);
}

export async function sendMail(message: Message) {
  const { resend, smtp, from } = providers();
  const headers = { ...(message.headers ?? {}) };
  if (message.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (resend) {
    const { error } = await resend.emails.send({ from, to: message.to, subject: message.subject, text: message.text, html: message.html, headers });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }
  if (smtp) {
    await smtp.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html, headers });
    return;
  }
  console.info(`[mail] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
}

// ------------------------------------------------------------------ template

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Paragraphs from plain text; a line that is only a URL becomes a link. */
function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim();
      if (/^https?:\/\/\S+$/.test(t))
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(t)}" style="color:#000;text-decoration:underline">${escapeHtml(t)}</a></p>`;
      return `<p style="margin:0 0 16px">${escapeHtml(t).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

type Template = {
  title: string;
  /** Plain text body; paragraphs separated by blank lines. */
  body: string;
  /** A big call to action, when there is one. */
  action?: { label: string; url: string };
  /** A one-time code set large, when there is one. */
  code?: string;
  /** Why the reader is getting this; always present. */
  reason: string;
  unsubscribeUrl?: string;
};

/** Black on white, one column, system fonts: renders the same in every client and prints well. */
export function render(t: Template) {
  const e = env();
  const base = e.NEXT_PUBLIC_APP_URL;
  const address = [e.LEGAL_ENTITY, e.LEGAL_ADDRESS].filter(Boolean).join(" · ");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(t.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#000">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e2e2e2">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #e2e2e2">
        <a href="${base}" style="color:#000;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:-0.01em">Denis<span style="color:#969393;font-weight:400"> Cloud</span></a>
      </td></tr>
      <tr><td style="padding:32px 32px 8px;font-size:15px;line-height:1.6">
        <h1 style="margin:0 0 20px;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-0.01em">${escapeHtml(t.title)}</h1>
        ${paragraphs(t.body)}
        ${
          t.code
            ? `<p style="margin:8px 0 24px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;letter-spacing:0.3em;font-weight:600">${escapeHtml(t.code)}</p>`
            : ""
        }
        ${
          t.action
            ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(t.action.url)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:6px">${escapeHtml(t.action.label)}</a></p>
               <p style="margin:0 0 16px;font-size:13px;color:#5c5959">If the button does not work, open this address:<br><a href="${escapeHtml(t.action.url)}" style="color:#000">${escapeHtml(t.action.url)}</a></p>`
            : ""
        }
      </td></tr>
      <tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e2e2;font-size:12.5px;line-height:1.6;color:#5c5959">
        <p style="margin:0 0 8px">${escapeHtml(t.reason)}</p>
        ${
          t.unsubscribeUrl
            ? `<p style="margin:0 0 8px">Do not want these messages? <a href="${escapeHtml(t.unsubscribeUrl)}" style="color:#5c5959">Unsubscribe</a> with one click, or change it under Settings.</p>`
            : ""
        }
        <p style="margin:0">${escapeHtml(address)}<br><a href="${base}/privacy" style="color:#5c5959">Privacy</a> · <a href="${base}/terms" style="color:#5c5959">Terms</a> · <a href="mailto:${escapeHtml(e.LEGAL_CONTACT_EMAIL)}" style="color:#5c5959">${escapeHtml(e.LEGAL_CONTACT_EMAIL)}</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
  const text = [
    t.title,
    "",
    t.body.trim(),
    t.code ? `\n${t.code}\n` : "",
    t.action ? `\n${t.action.label}: ${t.action.url}\n` : "",
    "—",
    t.reason,
    t.unsubscribeUrl ? `Unsubscribe: ${t.unsubscribeUrl}` : "",
    address,
    `${base}/privacy · ${base}/terms · ${e.LEGAL_CONTACT_EMAIL}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { html, text };
}

// ------------------------------------------------------------------ messages

export function passwordResetMail(to: string, url: string): Message {
  const r = render({
    title: "Reset your password",
    body: `Someone asked to reset the password of the Denis Cloud account ${to}.\n\nThe link below works once and expires in one hour.\n\nIf that was not you, ignore this message; the password stays as it is.`,
    action: { label: "Choose a new password", url },
    reason: "You are receiving this because a password reset was requested for this address on Denis Cloud.",
  });
  return { to, subject: "Reset your Denis Cloud password", ...r };
}

export function verificationCodeMail(to: string, code: string, minutes: number): Message {
  const r = render({
    title: "Confirm your email address",
    body: `Enter this code on Denis Cloud to confirm that ${to} is yours. It expires in ${minutes} minutes.`,
    code,
    reason:
      "You are receiving this because an account was created with this address on Denis Cloud. If it was not you, no action is needed; the account cannot be used without this code.",
  });
  return { to, subject: `${code} is your Denis Cloud verification code`, ...r };
}

export function signInCodeMail(to: string, code: string, minutes: number): Message {
  const r = render({
    title: "Your sign-in code",
    body: `Enter this code to sign in to Denis Cloud. It expires in ${minutes} minutes and works once.\n\nIf you did not try to sign in, someone typed your address; they cannot get in without this code.`,
    code,
    reason: "You are receiving this because a sign-in code was requested for this address on Denis Cloud.",
  });
  return { to, subject: `${code} is your Denis Cloud sign-in code`, ...r };
}

export function newSignInMail(to: string, info: { at: Date; ip: string | null; userAgent: string | null }): Message {
  const when = info.at.toUTCString();
  const where = [info.ip ? `address ${info.ip}` : null, info.userAgent ? `browser ${info.userAgent.slice(0, 140)}` : null].filter(Boolean).join(", ");
  const r = render({
    title: "New sign-in to your account",
    body: `Your Denis Cloud account was just signed in from a browser it had not used before.\n\nWhen: ${when}\n${where ? "Where: " + where + "\n" : ""}\nIf this was you, there is nothing to do.\n\nIf it was not you, change your password now: that signs out every other session. Then turn on the sign-in code under Settings so a password alone is not enough.`,
    action: { label: "Review account security", url: `${env().NEXT_PUBLIC_APP_URL}/settings` },
    reason:
      "You are receiving this because a new session was opened on your Denis Cloud account. These notices cannot be turned off; they are how you learn about a stolen password.",
  });
  return { to, subject: "New sign-in to your Denis Cloud account", ...r };
}

export function announcementMail(to: string, subject: string, body: string, unsubscribeUrl: string): Message {
  const r = render({
    title: subject,
    body,
    reason: "You are receiving this because you chose to get product updates from Denis Cloud.",
    unsubscribeUrl,
  });
  return { to, subject, ...r, unsubscribeUrl };
}

// -------------------------------------------------------------- unsubscribe

/** A signed, non-expiring link that switches one user's product updates off. */
export function unsubscribeUrl(userId: string) {
  const sig = createHmac("sha256", env().JWT_SECRET).update(`unsubscribe:${userId}`).digest("hex");
  return `${env().NEXT_PUBLIC_APP_URL}/api/mail/unsubscribe?u=${encodeURIComponent(userId)}&s=${sig}`;
}

export function verifyUnsubscribe(userId: string, sig: string) {
  const expected = createHmac("sha256", env().JWT_SECRET).update(`unsubscribe:${userId}`).digest("hex");
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

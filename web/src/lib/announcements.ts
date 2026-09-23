import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { GatewayError } from "@/lib/denis/client";
import { audit } from "@/lib/databases";
import { announcementMail, render, sendMail, unsubscribeUrl } from "@/lib/mail";
import type { PlatformUser } from "@/lib/session";

/**
 * Product announcements go only to accounts that opted in, are not
 * suspended, and have confirmed their address. Every message carries that
 * user's one-click unsubscribe link. Sending is sequential with a small
 * pause so a provider's rate limit is never hit.
 */
const { user } = schema;

export async function announcementAudience() {
  return db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(and(eq(user.marketingOptIn, true), eq(user.emailVerified, true), isNull(user.disabledAt)));
}

export function validateAnnouncement(subject: string, body: string) {
  if (subject.trim().length < 3 || subject.length > 120) throw new GatewayError("Subject: 3 to 120 characters", 400, "BAD_REQUEST");
  if (body.trim().length < 20 || body.length > 20_000) throw new GatewayError("Body: 20 to 20,000 characters", 400, "BAD_REQUEST");
}

/** What one recipient will see, for the preview. */
export function previewAnnouncement(subject: string, body: string) {
  validateAnnouncement(subject, body);
  return render({
    title: subject.trim(),
    body,
    reason: "You are receiving this because you chose to get product updates from Denis Cloud.",
    unsubscribeUrl: "#unsubscribe",
  });
}

export async function sendAnnouncement(admin: PlatformUser, subject: string, body: string, options: { testTo?: string } = {}) {
  validateAnnouncement(subject, body);
  if (options.testTo) {
    await sendMail(announcementMail(options.testTo, subject.trim(), body, unsubscribeUrl(admin.id)));
    return { sent: 1, failed: 0, test: true };
  }
  const audience = await announcementAudience();
  let sent = 0;
  let failed = 0;
  for (const person of audience) {
    try {
      await sendMail(announcementMail(person.email, subject.trim(), body, unsubscribeUrl(person.id)));
      sent++;
    } catch (err) {
      failed++;
      console.error(`[mail] announcement to ${person.email}:`, err);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await audit(admin.id, null, "admin.announcement", `${subject.trim()} -> ${sent} sent, ${failed} failed`);
  return { sent, failed, test: false };
}

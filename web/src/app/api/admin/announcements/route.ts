import { handler, ok, readJson } from "@/lib/api";
import { requireAdminApi } from "@/lib/admin";
import { announcementAudience, previewAnnouncement, sendAnnouncement } from "@/lib/announcements";
import { GatewayError } from "@/lib/denis/client";
import { mailConfigured } from "@/lib/mail";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/** Who would receive an announcement right now, and whether mail can leave the server. */
export const GET = handler(async () => {
  await requireAdminApi();
  const audience = await announcementAudience();
  return ok({ recipients: audience.length, mailConfigured: mailConfigured() });
});

/**
 * Body: { subject, body, action: "preview" | "test" | "send", testTo? }
 * preview -> the rendered HTML; test -> one message to testTo; send -> everyone opted in.
 */
export const POST = handler(async (request: Request) => {
  const admin = await requireAdminApi();
  const body = await readJson<{ subject?: string; body?: string; action?: string; testTo?: string }>(request);
  const subject = String(body.subject ?? "");
  const text = String(body.body ?? "");
  switch (body.action) {
    case "preview":
      return ok({ html: previewAnnouncement(subject, text).html });
    case "test":
      rateLimit(`announce:${admin.id}`, LIMITS.account.max, LIMITS.account.windowMs, "test sends");
      return ok(await sendAnnouncement(admin, subject, text, { testTo: String(body.testTo || admin.email) }));
    case "send":
      rateLimit(`announce-all:${admin.id}`, 3, 60 * 60_000, "announcements");
      return ok(await sendAnnouncement(admin, subject, text));
    default:
      throw new GatewayError("action must be preview, test or send", 400, "BAD_REQUEST");
  }
});

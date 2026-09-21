import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyUnsubscribe } from "@/lib/mail";

/**
 * One-click unsubscribe from product updates. The link is signed per user
 * and needs no session, so it works from any mail client: GET shows a
 * confirmation page, POST (RFC 8058 List-Unsubscribe=One-Click) just does it.
 */
async function unsubscribe(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  if (!userId || !sig || !verifyUnsubscribe(userId, sig)) return false;
  await db.update(schema.user).set({ marketingOptIn: false }).where(eq(schema.user.id, userId));
  return true;
}

export async function POST(request: Request) {
  const ok = await unsubscribe(request);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}

const STYLE =
  "body{margin:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#000}" +
  "main{max-width:560px;margin:48px auto;background:#fff;border:1px solid #e2e2e2;padding:32px}h1{font-size:22px;margin:0 0 16px}p{font-size:15px;line-height:1.6;margin:0 0 12px}a{color:#000}";

export async function GET(request: Request) {
  const ok = await unsubscribe(request);
  const base = env().NEXT_PUBLIC_APP_URL;
  const body = ok
    ? `<h1>You are unsubscribed</h1><p>You will not receive product updates from Denis Cloud any more. Codes and password resets still arrive, because the service cannot work without them.</p><p>Changed your mind? Turn updates back on under <a href="${base}/settings">Settings</a>.</p>`
    : `<h1>This link is not valid</h1><p>Open the unsubscribe link from the latest message, or change your preference under <a href="${base}/settings">Settings</a>.</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Denis Cloud</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

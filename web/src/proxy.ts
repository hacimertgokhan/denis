import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirects based on the session cookie: signed-out users go to
 * /login for app pages, signed-in users skip the auth pages. Real
 * authorization happens in the server components and route handlers.
 */
const PROTECTED = ["/dashboard", "/databases", "/usage", "/settings", "/admin"];
const AUTH_PAGES = ["/login", "/login/code", "/register"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Public forms that bots aim at. Serving one of these pages stamps a signed
 * cookie with the server's clock; the auth hook then requires that the form
 * was open for a moment before it was submitted. Server time on both sides,
 * so a client with a wrong clock is never refused.
 */
const FORM_PAGES = new Set(["/register", "/forgot-password", "/login/code", "/verify-email"]);
export const FORM_COOKIE = "denis_form";

async function formToken(secret: string) {
  const ts = String(Date.now());
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`form:${ts}`));
  return `${ts}.${Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Cross-site request forgery guard for the API: a state-changing request
 * that a browser marks as coming from another site, or whose Origin is not
 * ours, is refused before any handler runs. Non-browser clients (curl, the
 * Node client, MCP clients) send neither header and pass. better-auth has
 * its own check for /api/auth.
 */
function crossSite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    return host !== request.nextUrl.host && host !== request.headers.get("host");
  } catch {
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (FORM_PAGES.has(pathname) && request.method === "GET") {
    const response = NextResponse.next();
    const secret = process.env.BETTER_AUTH_SECRET;
    if (secret) {
      response.cookies.set(FORM_COOKIE, await formToken(secret), {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60,
      });
    }
    return response;
  }
  if (pathname.startsWith("/api/") && crossSite(request)) {
    return NextResponse.json({ error: { code: "CROSS_SITE", message: "Cross-site requests are not accepted" } }, { status: 403 });
  }
  const hasSession = request.cookies.getAll().some((c) => /better-auth\.session_token/.test(c.name));
  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/databases/:path*",
    "/usage/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/login",
    "/login/code",
    "/register",
    "/forgot-password",
    "/verify-email",
    "/api/:path*",
  ],
};

import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirects based on the session cookie: signed-out users go to
 * /login for app pages, signed-in users skip the auth pages. Real
 * authorization happens in the server components and route handlers.
 */
const PROTECTED = ["/dashboard", "/databases", "/usage", "/settings", "/admin"];
const AUTH_PAGES = ["/login", "/register"];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/dashboard/:path*", "/databases/:path*", "/usage/:path*", "/settings/:path*", "/admin/:path*", "/login", "/register", "/api/:path*"],
};

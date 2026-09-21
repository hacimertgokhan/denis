import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirects based on the session cookie: signed-out users go to
 * /login for app pages, signed-in users skip the auth pages. Real
 * authorization happens in the server components and route handlers.
 */
const PROTECTED = ["/dashboard", "/databases", "/usage", "/settings"];
const AUTH_PAGES = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/dashboard/:path*", "/databases/:path*", "/usage/:path*", "/settings/:path*", "/login", "/register"],
};

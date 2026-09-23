import path from "node:path";
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
const turnstile = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

// One policy for every route. Scripts stay 'self' (plus inline for Next's
// hydration data, and 'unsafe-eval' for the dev overlay only); nothing is
// loaded from third parties except GitHub avatars.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${turnstile ? " https://challenges.cloudflare.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  `frame-src ${turnstile ? "https://challenges.cloudflare.com" : "'none'"}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Standalone output for the Docker image (see Dockerfile).
  output: "standalone",
  // The Node client lives in the monorepo (../clients/node) and is linked in
  // with `file:`; the root must include it for Turbopack and file tracing.
  turbopack: { root: path.join(__dirname, "..") },
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: ["denis-client", "postgres"],
};

export default nextConfig;

"use strict";

/**
 * Security helpers shared by the main process.
 *
 * The renderer is served from a custom, privileged `studio://app/` scheme
 * (not file://): only files below src/renderer are reachable, every response
 * carries the Content-Security-Policy, and anything else (http, file, data
 * frames...) is refused at the network layer.
 */

const path = require("node:path");

const SCHEME = "studio";
const HOST = "app";
const ORIGIN = `${SCHEME}://${HOST}`;
const START_URL = `${ORIGIN}/index.html`;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Map a studio:// URL to a file below `root`, or null when it is outside,
 * malformed, or not our host.
 */
function resolveAppPath(root, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.host !== HOST) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const base = path.resolve(root);
  const full = path.resolve(base, "." + path.posix.normalize(pathname));
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext]) return null;
  return { file: full, type: MIME[ext] };
}

/** Is this URL one of our own pages (for navigation / sender checks)? */
function isAppUrl(u) {
  return typeof u === "string" && (u === ORIGIN || u.startsWith(`${ORIGIN}/`));
}

function responseHeaders(type) {
  return {
    "content-type": type,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  };
}

module.exports = { SCHEME, HOST, ORIGIN, START_URL, CSP, MIME, resolveAppPath, isAppUrl, responseHeaders };

import { GatewayError } from "@/lib/denis/client";

/**
 * Fixed-window counters in process memory. One key per (route, subject);
 * the map is pruned on the way so it cannot grow without bound. Good enough
 * for one instance; put a shared store behind the same signature when the
 * app runs on several.
 */
const windows = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/** Count one hit; throws 429 once `max` hits fall inside `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number, what = "requests") {
  const now = Date.now();
  sweep(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  w.count++;
  if (w.count > max) {
    const wait = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    throw new GatewayError(`Too many ${what}; try again in ${wait} s`, 429, "RATE_LIMIT");
  }
}

/** The caller's address as seen through a reverse proxy (first hop of X-Forwarded-For), or "local". */
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "local";
}

/** Common budgets. Windows are short so a burst from one address never blocks others. */
export const LIMITS = {
  /** database-account sign-in: per address+database and per username */
  dbLogin: { max: 10, windowMs: 10 * 60_000 },
  /** API key -> JWT exchange */
  token: { max: 30, windowMs: 60_000 },
  /** console commands per signed-in user */
  console: { max: 600, windowMs: 60_000 },
  /** management writes (members, accounts, keys, databases) per user */
  manage: { max: 60, windowMs: 60_000 },
  /** account export / deletion per user */
  account: { max: 5, windowMs: 10 * 60_000 },
} as const;

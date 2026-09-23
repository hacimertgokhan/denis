import { NextResponse } from "next/server";
import { GatewayError } from "@/lib/denis/client";

/** JSON helpers and the single error shape of the REST API: { error: { code, message } }. */
export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(err: unknown) {
  if (err instanceof GatewayError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("API error:", err);
  return NextResponse.json({ error: { code: "INTERNAL", message } }, { status: 500 });
}

const MAX_BODY = 256 * 1024;

/**
 * Parse a JSON body. The content type must say JSON (a text/plain form post
 * from another site is rejected, which closes the classic CSRF trick) and
 * the body is capped at 256 KB.
 */
export async function readJson<T>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new GatewayError("Content-Type must be application/json", 415, "UNSUPPORTED_MEDIA_TYPE");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new GatewayError("Body too large (256 KB max)", 413, "PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new GatewayError("Body too large (256 KB max)", 413, "PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GatewayError("Body must be JSON", 400, "BAD_JSON");
  }
}

/** Route handler wrapper: turns thrown GatewayErrors into responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err);
    }
  };
}

export function publicDatabase(row: {
  id: string;
  name: string;
  slug: string;
  region: string;
  maxBytes: number;
  maxKeys: number;
  opsPerDay: number;
  cachedKeys: number;
  cachedBytes: number;
  persistedKeys: number;
  persistedBytes: number;
  usageSampledAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    region: row.region,
    limits: { maxBytes: row.maxBytes, maxKeys: row.maxKeys, opsPerDay: row.opsPerDay },
    usage: {
      cachedKeys: row.cachedKeys,
      cachedBytes: row.cachedBytes,
      persistedKeys: row.persistedKeys,
      persistedBytes: row.persistedBytes,
      sampledAt: row.usageSampledAt,
    },
    createdAt: row.createdAt,
  };
}

export function publicKey(k: { id: string; name: string; prefix: string; scope: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return { id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt };
}

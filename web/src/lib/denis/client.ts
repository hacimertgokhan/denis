import { type ServerInfo, DenisClient, DenisError, type DenisReply, type ProjectInfo } from "denis-client";
import { env } from "@/lib/env";

/**
 * The platform's door to the Denis server. Users never talk to Denis
 * directly: every console command, API call and MCP tool goes through here
 * with the database's project token, and administration (create, quota,
 * usage, drop) uses the server's main token.
 *
 * One pooled client per project token is kept for reuse; idle clients are
 * closed after a while so a long-running process does not hold thousands of
 * sockets.
 */

const POOL_SIZE = 2;
const MAX_CLIENTS = 200;
const IDLE_MS = 10 * 60 * 1000;

type Entry = { client: DenisClient; lastUsed: number };

const globalForDenis = globalThis as unknown as {
  __denisClients?: Map<string, Entry>;
  __denisAdmin?: DenisClient;
  __denisSweeper?: NodeJS.Timeout;
};

const clients = (globalForDenis.__denisClients ??= new Map<string, Entry>());

function baseOptions() {
  const e = env();
  return {
    host: e.DENIS_HOST,
    port: e.DENIS_PORT,
    group: e.DENIS_GROUP,
    password: e.DENIS_PASSWORD,
    poolSize: POOL_SIZE,
    connectTimeout: 5000,
    commandTimeout: 15000,
  };
}

function sweep() {
  const now = Date.now();
  for (const [token, entry] of clients) {
    if (now - entry.lastUsed > IDLE_MS) {
      clients.delete(token);
      void entry.client.close().catch(() => {});
    }
  }
}

if (!globalForDenis.__denisSweeper) {
  globalForDenis.__denisSweeper = setInterval(sweep, 60_000);
  globalForDenis.__denisSweeper.unref?.();
}

/** A client bound to one database (project token). */
export function forToken(token: string): DenisClient {
  const existing = clients.get(token);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  if (clients.size >= MAX_CLIENTS) {
    // evict the least recently used
    let oldest: [string, Entry] | null = null;
    for (const item of clients) {
      if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
    }
    if (oldest) {
      clients.delete(oldest[0]);
      void oldest[1].client.close().catch(() => {});
    }
  }
  const client = new DenisClient({ ...baseOptions(), token });
  clients.set(token, { client, lastUsed: Date.now() });
  return client;
}

/** Drop the pooled client of a token (after the project was deleted). */
export async function forget(token: string) {
  const entry = clients.get(token);
  if (entry) {
    clients.delete(token);
    await entry.client.close().catch(() => {});
  }
}

/** ADMIN commands with the main token. */
export function admin() {
  if (!globalForDenis.__denisAdmin) {
    globalForDenis.__denisAdmin = new DenisClient(baseOptions());
  }
  return globalForDenis.__denisAdmin.admin(env().DENIS_MAIN_TOKEN);
}

/** Server INFO (version, uptime, connections, key counts) via the admin connection. */
export async function info(): Promise<ServerInfo> {
  if (!globalForDenis.__denisAdmin) {
    globalForDenis.__denisAdmin = new DenisClient(baseOptions());
  }
  return globalForDenis.__denisAdmin.info();
}

export async function ping(): Promise<boolean> {
  try {
    if (!globalForDenis.__denisAdmin) {
      globalForDenis.__denisAdmin = new DenisClient(baseOptions());
    }
    return await globalForDenis.__denisAdmin.ping();
  } catch {
    return false;
  }
}

export type { DenisReply, ProjectInfo };
export { DenisClient, DenisError };

// ------------------------------------------------------------------ commands

const READ_COMMANDS = new Set(["GET", "MGET", "EXISTS", "KEYS", "QUERY", "INFO", "HELP", "PING", "SELECT", "SHOW", "DESCRIBE", "DESC"]);
const FORBIDDEN = new Set(["LIN", "AUTH", "ADMIN", "MODE", "EXIT", "QUIT"]);

export type Classified = { kind: "read" | "write"; verb: string };

/**
 * Classify a protocol line: which commands count as reads, and which are
 * never allowed through the platform (session control belongs to the gateway).
 */
export function classify(line: string): Classified {
  const trimmed = line.trim();
  let verb = trimmed.split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  if (verb === "SQL") {
    verb = trimmed.slice(4).trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  }
  if (FORBIDDEN.has(verb)) {
    throw new GatewayError(`${verb} is managed by the platform and cannot be sent directly`, 400);
  }
  if (!verb) {
    throw new GatewayError("empty command", 400);
  }
  return { kind: READ_COMMANDS.has(verb) ? "read" : "write", verb };
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "BAD_REQUEST",
  ) {
    super(message);
  }
}

/**
 * The engine answers "Cannot auth with" / "Unknown project" when its registry
 * no longer has a token the platform still holds (a data-less container
 * restart, a restore from an older backup). The platform is the source of
 * truth for which projects exist, so it re-registers the token with its
 * limits and the caller retries once.
 */
export function isMissingProject(err: unknown) {
  const message = String((err as { message?: string })?.message ?? err);
  return /Cannot auth with|Unknown project/.test(message);
}

export async function restoreProject(token: string, limits?: { maxKeys: number; maxBytes: number }) {
  await forget(token);
  await admin().import(token, limits);
}

/** Send one protocol line for a database and return the raw reply object; a project missing from the engine is restored once. */
export async function execute(token: string, line: string, limits?: { maxKeys: number; maxBytes: number }): Promise<DenisReply> {
  if (/[\r\n]/.test(line)) {
    throw new GatewayError("a command is a single line", 400);
  }
  if (line.length > 64 * 1024) {
    throw new GatewayError("a command is at most 64 KB", 413, "PAYLOAD_TOO_LARGE");
  }
  const attempt = async () => forToken(token).command(line);
  try {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof DenisError) || !isMissingProject(err)) throw err;
      await restoreProject(token, limits);
      return await attempt();
    }
  } catch (err) {
    if (err instanceof DenisError) {
      const status = err.code === "EAUTH" ? 502 : err.code === "ETIMEOUT" ? 504 : 502;
      throw new GatewayError(`Denis: ${err.message}`, status, err.code);
    }
    throw err;
  }
}

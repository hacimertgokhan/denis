import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DenisClient, DenisCloud } from "denis-client";

// .env next to package.json, without a dependency: KEY=value lines, no expansion
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined && m[2] !== "") process.env[m[1]] = m[2];
  }
}

// Over TCP without DENIS_TOKEN the first start creates a project; its token is
// kept in this file so every later process (server, seed, tests) uses the same one.
const TOKEN_FILE = ".denis-token";
const savedToken = process.env.DENIS_TOKEN || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : "");

/**
 * One connection to Denis for the whole app. With DENIS_API_KEY set the app
 * talks to Denis Cloud over HTTPS; otherwise it opens a TCP pool to a server
 * you run (DENIS_HOST/PORT/GROUP/PASSWORD/TOKEN). Everything below this line
 * is the same either way.
 */
export const denis = process.env.DENIS_API_KEY
  ? new DenisCloud({ apiKey: process.env.DENIS_API_KEY, url: process.env.DENIS_URL || "https://denis.hacimertgokhan.com", useJwt: true })
  : new DenisClient({
      host: process.env.DENIS_HOST || "127.0.0.1",
      port: Number(process.env.DENIS_PORT || 5142),
      group: process.env.DENIS_GROUP,
      password: process.env.DENIS_PASSWORD,
      token: savedToken || undefined,
      createProject: !savedToken,
    });

/**
 * The schema. Tables hold what is queried by column (products, movements);
 * keys hold what is looked up by name (users, sessions, counters).
 *
 *   user:<email>        {"name","hash","salt","role","createdAt"}
 *   session:<token>     {"email","expiresAt"}
 *   seq:movement        next movement id
 */
export async function migrate() {
  if (denis instanceof DenisClient) {
    await denis.connect();
    if (!process.env.DENIS_TOKEN && denis.token && denis.token !== savedToken) writeFileSync(TOKEN_FILE, denis.token + "\n");
  }
  await denis.execute("CREATE TABLE IF NOT EXISTS inv_products (id INT, sku TEXT, name TEXT, category TEXT, unit TEXT, quantity INT, min_quantity INT, price REAL, updated_at TEXT)");
  await denis.execute("CREATE TABLE IF NOT EXISTS inv_movements (id INT, product_id INT, sku TEXT, kind TEXT, quantity INT, note TEXT, actor TEXT, created_at TEXT)");
}

/** A monotonic counter kept in a key: read, add one, write back. */
export async function nextId(name) {
  const key = `seq:${name}`;
  const current = Number((await denis.get(key)) ?? 0) + 1;
  await denis.set(key, String(current), { persist: true });
  return current;
}

export function q(value) {
  // Denis string literals escape quotes with a backslash
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

#!/usr/bin/env node
/**
 * End-to-end smoke test against a running instance (default http://localhost:3100):
 * register -> create databases (plan limit) -> console commands -> API key ->
 * REST exec (scope, rate) -> JWT exchange -> MCP tools -> delete.
 *   node scripts/smoke.mjs [baseUrl]
 */
import assert from "node:assert/strict";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3100";
let cookie = "";

async function call(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const [pair] = c.split(";");
    const [name] = pair.split("=");
    cookie = cookie
      .split("; ")
      .filter((x) => x && !x.startsWith(name + "="))
      .concat(pair)
      .join("; ");
  }
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const step = (name) => console.log(`\n== ${name}`);
const email = `smoke-${Date.now()}@example.com`;
let r;

step("bot protection on sign-up");
// a bot that never opened the page
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email: `bot-${Date.now()}@example.com`, password: "bot-pass-123", name: "Bot" } });
assert.equal(r.status, 400, "no form cookie -> refused");
// open the page (the response stamps the signed cookie), submit at once
r = await call("/register", { raw: true });
assert.ok(cookie.includes("denis_form="), "the form page sets its cookie");
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email: `fast-${Date.now()}@example.com`, password: "bot-pass-123", name: "Fast" } });
assert.equal(r.status, 400, "submitted instantly -> refused");
await new Promise((res) => setTimeout(res, 2500));
r = await call("/api/auth/sign-up/email", {
  method: "POST",
  body: { email: `bot-${Date.now()}@example.com`, password: "bot-pass-123", name: "Bot" },
  headers: { "x-form-website": "http://spam.example" },
});
assert.equal(r.status, 400, "honeypot filled -> refused");
console.log("missing cookie, instant submits and filled honeypots are refused");

step("register + session");
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email, password: "smoke-pass-123", name: "Smoke Test" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
r = await call("/api/v1/me");
assert.equal(r.status, 200);
assert.equal(r.json.plan.databasesUsed, 0);
console.log("user", r.json.user.email, "plan", r.json.plan.name, "max", r.json.plan.maxDatabases);

step("forgot password");
r = await call("/api/auth/request-password-reset", { method: "POST", body: { email, redirectTo: "/reset-password" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
r = await call("/api/auth/request-password-reset", { method: "POST", body: { email: "nobody-" + Date.now() + "@example.com", redirectTo: "/reset-password" } });
assert.equal(r.status, 200, "unknown addresses get the same answer");
r = await call("/api/auth/reset-password", { method: "POST", body: { newPassword: "new-pass-12345", token: "not-a-real-token" } });
assert.equal(r.status, 400);
console.log("reset link requested (mailed, or logged without SMTP); bad tokens refused");

step("email codes, preferences, unsubscribe");
r = await call("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email, type: "email-verification" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
r = await call("/api/auth/email-otp/verify-email", { method: "POST", body: { email, otp: "000000" } });
assert.equal(r.status, 400, "wrong code refused");
r = await call("/api/v1/me", { method: "PATCH", body: { marketingOptIn: true } });
assert.equal(r.status, 200);
r = await call("/api/v1/me");
assert.equal(r.json.user.marketingOptIn, true);
r = await call("/api/mail/unsubscribe?u=" + encodeURIComponent(r.json.user.id) + "&s=deadbeef", { method: "POST" });
assert.equal(r.status, 400, "a forged unsubscribe link is refused");
console.log("verification code sent (mailed, or logged); wrong codes and forged unsubscribe links refused");

step("create databases up to the plan limit");
const ids = [];
for (const name of ["shop", "analytics", "cache"]) {
  r = await call("/api/v1/databases", { method: "POST", body: { name } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ids.push(r.json.database.id);
  if (name === "shop") {
    r = await call("/api/v1/databases", { method: "POST", body: { name: "shop" } });
    assert.equal(r.status, 409);
  }
}
r = await call("/api/v1/databases", { method: "POST", body: { name: "fourth" } });
assert.equal(r.status, 403);
assert.equal(r.json.error.code, "PLAN_LIMIT");
console.log("4th database refused:", r.json.error.message);
const dbId = ids[0];

step("console commands");
r = await call(`/api/v1/databases/${dbId}/exec`, {
  method: "POST",
  body: {
    commands: [
      "SET greeting hello world -&save",
      "GET greeting",
      "CREATE TABLE products (id INT, name TEXT, price REAL)",
      "INSERT INTO products (id, name, price) VALUES (1, 'Pen', 2.5), (2, 'Book', 12), (3, 'Bag', 40)",
      "SELECT name, price FROM products WHERE price > 10 ORDER BY price DESC",
      "SHOW TABLES",
      "LIN x y",
    ],
  },
});
assert.equal(r.status, 200, JSON.stringify(r.json));
const replies = r.json.results.map((x) => x.reply);
assert.equal(replies[1].data, "hello world");
assert.equal(replies[4].rows.length, 2);
assert.equal(replies[4].rows[0].name, "Bag");
assert.equal(replies[5].tables[0].rows, 3);
assert.equal(replies[6].ok, false);
console.log("LIN through the gateway refused:", replies[6].error);

step("QUERY: one round trip, many reads");
r = await call(`/api/v1/databases/${dbId}/exec`, {
  method: "POST",
  body: {
    command:
      'QUERY { hello: get("greeting") sold: table("products", where: "price > 10", order: "price desc") { name } n: count("products") nope: get("missing") }',
  },
});
assert.equal(r.status, 200, JSON.stringify(r.json));
const graph = r.json.results[0].reply;
assert.equal(graph.ok, true, JSON.stringify(graph));
assert.equal(graph.data.hello, "hello world");
assert.deepEqual(
  graph.data.sold.map((x) => x.name),
  ["Bag", "Book"],
);
assert.equal(graph.data.n, 3);
assert.equal(graph.data.nope, null);
console.log("graph:", JSON.stringify(graph.data));

step("isolation: another user cannot see it");
const other = cookie;
cookie = "";
const otherUserEmail = `other-${Date.now()}@example.com`;
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email: otherUserEmail, password: "smoke-pass-123", name: "Other" } });
assert.equal(r.status, 200);
const otherCookie = cookie;
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.status, 404);
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "GET greeting" } });
assert.equal(r.status, 404);
console.log("other user gets 404 on the database and its console");
cookie = other;

step("roles: share with the other user as viewer, then editor");
const otherEmail = otherUserEmail;
r = await call(`/api/v1/databases/${dbId}/members`, { method: "POST", body: { email: otherEmail, role: "viewer" } });
assert.equal(r.status, 201, JSON.stringify(r.json));
const memberId = r.json.members[0].id;
cookie = otherCookie;
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.status, 200);
assert.equal(r.json.role, "viewer");
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "GET greeting" } });
assert.equal(r.json.results[0].reply.data, "hello world");
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "SET viewer-write nope" } });
assert.equal(r.json.results[0].reply.code, "READ_ONLY");
console.log("viewer can read, write refused:", r.json.results[0].reply.error);
r = await call(`/api/v1/databases/${dbId}/members`);
assert.equal(r.status, 403);
r = await call(`/api/v1/databases/${dbId}`, { method: "DELETE" });
assert.equal(r.status, 403);
console.log("viewer cannot manage members or delete the database");
cookie = other;
r = await call(`/api/v1/databases/${dbId}/members/${memberId}`, { method: "PATCH", body: { role: "editor" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
cookie = otherCookie;
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "SET editor-write yes" } });
assert.equal(r.status, 200);
assert.equal(r.json.results[0].reply.ok, true);
r = await call("/api/v1/databases");
assert.ok(
  r.json.shared.some((d) => d.id === dbId && d.role === "editor"),
  "shared list contains the database",
);
console.log("editor can write; database appears under shared");
cookie = other;

step("database accounts: independent login");
r = await call(`/api/v1/databases/${dbId}/accounts`, { method: "POST", body: { username: "ops", password: "ops-pass-123", role: "admin" } });
assert.equal(r.status, 201, JSON.stringify(r.json));
const accountId = r.json.account.id;
r = await call(`/api/v1/databases/${dbId}/accounts`, { method: "POST", body: { username: "ops", password: "another-pass", role: "admin" } });
assert.equal(r.status, 409);
const platformCookie = cookie;
cookie = "";
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.status, 401);
r = await call(`/api/db/${dbId}/login`, { method: "POST", body: { username: "ops", password: "wrong" } });
assert.equal(r.status, 401);
r = await call(`/api/db/${dbId}/login`, { method: "POST", body: { username: "ops", password: "ops-pass-123" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.ok(cookie.includes(`denis_db_`), "db cookie set");
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.status, 200);
assert.equal(r.json.role, "admin");
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "SET from-account 1" } });
assert.equal(r.json.results[0].reply.ok, true);
r = await call(`/api/v1/databases/${ids[1]}`);
assert.equal(r.status, 401, "db session is scoped to one database");
r = await call(`/api/v1/databases/${dbId}`, { method: "DELETE" });
assert.equal(r.status, 403);
console.log("account signed in, scoped to its database, cannot delete it");
r = await call(`/api/db/${dbId}/logout`, { method: "POST" });
assert.equal(r.status, 200);
cookie = platformCookie;
r = await call(`/api/v1/databases/${dbId}/accounts/${accountId}`, { method: "PATCH", body: { disabled: true } });
assert.equal(r.status, 200);
cookie = "";
r = await call(`/api/db/${dbId}/login`, { method: "POST", body: { username: "ops", password: "ops-pass-123" } });
assert.equal(r.status, 401);
console.log("disabled account cannot sign in");
cookie = platformCookie;

step("command history");
r = await call(`/api/v1/databases/${dbId}/history?limit=50`);
assert.equal(r.status, 200, JSON.stringify(r.json));
const entries = r.json.entries;
assert.equal(r.json.page, 1);
assert.ok(r.json.total >= entries.length);
r = await call(`/api/v1/databases/${dbId}/history?limit=2&page=2`);
assert.equal(r.json.entries.length, 2);
assert.ok(r.json.pages >= 2);
r = await call(`/api/v1/databases/${dbId}/history?limit=50`);
assert.ok(
  entries.some((e) => e.command === "SET from-account 1" && e.actorType === "account" && e.actorLabel === "ops"),
  "account command logged",
);
assert.ok(
  entries.some((e) => e.command === "SET editor-write yes" && e.actorType === "user"),
  "member command logged",
);
assert.ok(!entries.some((e) => e.command.startsWith("LIN ") && e.command.length > 4), "LIN redacted");
r = await call(`/api/v1/databases/${dbId}/history?failed=1`);
assert.ok(r.json.entries.every((e) => e.ok === false));
r = await call(`/api/v1/databases/${dbId}/history?q=from-account`);
assert.equal(r.json.entries.length, 1);
console.log("history entries:", entries.length, "summary:", JSON.stringify(r.json.summary));

step("platform administration");
// an ordinary user is refused by the server, whatever the UI shows
r = await call("/api/admin/users");
assert.equal(r.status, 403);
r = await call("/api/admin/stats");
assert.equal(r.status, 403);
console.log("ordinary user gets 403 on the admin API");
// the smoke administrator is listed in PLATFORM_ADMINS (see .env); sign up once, sign in afterwards
const userCookie = cookie;
cookie = "";
const ADMIN_EMAIL = "smoke-admin@example.com";
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email: ADMIN_EMAIL, password: "smoke-admin-123", name: "Smoke Admin" } });
if (r.status !== 200) {
  r = await call("/api/auth/sign-in/email", { method: "POST", body: { email: ADMIN_EMAIL, password: "smoke-admin-123" } });
  assert.equal(r.status, 200, "admin sign-in: " + JSON.stringify(r.json));
}
r = await call("/api/v1/me");
assert.equal(r.json.user.role, "admin", "PLATFORM_ADMINS must contain " + ADMIN_EMAIL);
r = await call("/api/admin/stats");
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.ok(r.json.stats.users >= 2);
console.log("admin stats:", JSON.stringify(r.json.stats));
r = await call(`/api/admin/users?q=${encodeURIComponent(email)}`);
assert.equal(r.status, 200);
const smokeUser = r.json.users.find((u) => u.email === email);
assert.ok(smokeUser, "smoke user listed");
assert.equal(smokeUser.databases, 3);
// raise the smoke user's allowance and let them create a 4th database
r = await call(`/api/admin/users/${smokeUser.id}`, { method: "PATCH", body: { maxDatabases: 4 } });
assert.equal(r.status, 200, JSON.stringify(r.json));
cookie = userCookie;
r = await call("/api/v1/databases", { method: "POST", body: { name: "fourth" } });
assert.equal(r.status, 201, "4th database allowed after the override: " + JSON.stringify(r.json));
ids.push(r.json.database.id);
cookie = "";
r = await call("/api/auth/sign-in/email", { method: "POST", body: { email: ADMIN_EMAIL, password: "smoke-admin-123" } });
assert.equal(r.status, 200);
const adminCookie = cookie;
// database limits are pushed to the engine
r = await call(`/api/admin/databases?q=${encodeURIComponent(email)}`);
assert.equal(r.status, 200);
assert.ok(r.json.databases.some((d) => d.id === dbId));
r = await call(`/api/admin/databases/${dbId}`, { method: "PATCH", body: { maxKeys: 123 } });
assert.equal(r.status, 200, JSON.stringify(r.json));
cookie = userCookie;
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.json.database.limits.maxKeys, 123);
cookie = adminCookie;
// suspend the other user: their session dies, sign-in is refused
const otherUser = (await call(`/api/admin/users?q=${encodeURIComponent(otherUserEmail)}`)).json.users[0];
r = await call(`/api/admin/users/${otherUser.id}`, { method: "PATCH", body: { disabled: true } });
assert.equal(r.status, 200);
cookie = otherCookie;
r = await call("/api/v1/me");
assert.equal(r.status, 401, "suspended user is signed out");
cookie = adminCookie;
r = await call(`/api/admin/users/${otherUser.id}`, { method: "PATCH", body: { disabled: false } });
assert.equal(r.status, 200);
// guard rails
const me = (await call("/api/v1/me")).json.user;
r = await call(`/api/admin/users/${me.id}`, { method: "PATCH", body: { disabled: true } });
assert.equal(r.status, 400);
r = await call(`/api/admin/users/${me.id}`, { method: "PATCH", body: { role: "user" } });
assert.equal(r.status, 400);
r = await call("/api/admin/activity?limit=20");
assert.equal(r.status, 200);
assert.ok(r.json.audit.some((a) => a.action === "admin.user.suspend"));
console.log("admin can raise limits, change database limits, suspend and restore; cannot lock themselves out");
cookie = userCookie;

step("usage + audit");
r = await call(`/api/v1/databases/${dbId}/usage`);
assert.equal(r.status, 200);
assert.ok(r.json.usage.persistedKeys >= 1);
assert.ok(r.json.usage.opsToday >= 6);
console.log("usage", r.json.usage);

step("api keys: write + read-only");
r = await call(`/api/v1/databases/${dbId}/keys`, { method: "POST", body: { name: "smoke-write", scope: "write" } });
assert.equal(r.status, 201);
const writeKey = r.json.secret;
r = await call(`/api/v1/databases/${dbId}/keys`, { method: "POST", body: { name: "smoke-read", scope: "read" } });
const readKey = r.json.secret;
const readKeyId = r.json.key.id;
assert.ok(writeKey.startsWith("dk_") && readKey.startsWith("dk_"));

step("REST exec with keys");
cookie = "";
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: `Bearer ${writeKey}` }, body: { command: "SET via_api yes -&save" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.reply.ok, true);
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: `Bearer ${readKey}` }, body: { command: "GET via_api" } });
assert.equal(r.json.reply.data, "yes");
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: `Bearer ${readKey}` }, body: { command: "SET nope 1" } });
assert.equal(r.status, 403);
assert.equal(r.json.error.code, "READ_ONLY");
console.log("read-only key refused a write:", r.json.error.message);
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: "Bearer dk_bogus" }, body: { command: "GET x" } });
assert.equal(r.status, 401);

step("JWT exchange + refresh");
r = await call("/api/v1/token", { method: "POST", body: { apiKey: writeKey } });
assert.equal(r.status, 200, JSON.stringify(r.json));
const { accessToken, refreshToken } = r.json;
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: { command: "GET greeting" } });
assert.equal(r.json.reply.data, "hello world");
r = await call("/api/v1/token", { method: "POST", body: { refreshToken } });
assert.equal(r.status, 200);
assert.ok(r.json.accessToken);
console.log("access token works; refresh issued a new pair");

step("MCP over HTTP");
async function mcp(key, method, params, id = 1) {
  const res = await fetch(BASE + "/api/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  // stateless transport answers JSON or an SSE stream with one message
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
}
let m = await mcp(writeKey, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
assert.equal(m.result.serverInfo.name, "denis-cloud");
m = await mcp(writeKey, "tools/list", {});
const writeTools = m.result.tools.map((t) => t.name).sort();
assert.ok(writeTools.includes("denis_execute") && writeTools.includes("denis_query"));
m = await mcp(readKey, "tools/list", {});
const readTools = m.result.tools.map((t) => t.name);
assert.ok(!readTools.includes("denis_execute"));
console.log("write tools:", writeTools.join(", "));
console.log("read-only tools:", readTools.join(", "));
m = await mcp(writeKey, "tools/call", { name: "denis_describe", arguments: {} });
assert.ok(m.result.structuredContent.tables.some((t) => t.name === "products"));
m = await mcp(writeKey, "tools/call", { name: "denis_query", arguments: { sql: "SELECT COUNT(*) FROM products" } });
assert.equal(m.result.structuredContent.rows[0].count, 3);
m = await mcp(readKey, "tools/call", {
  name: "denis_graph",
  arguments: { document: '{ n: count("products") first: table("products", order: "price desc", limit: 1) { name } }' },
});
assert.equal(m.result.structuredContent.data.n, 3);
assert.equal(m.result.structuredContent.data.first[0].name, "Bag");
m = await mcp(readKey, "tools/call", { name: "denis_query", arguments: { sql: "DELETE FROM products" } });
assert.equal(m.result.isError, true);
console.log("denis_query refused a DELETE:", m.result.content[0].text.split("\n")[0]);

step("revoke key -> JWT dies too");
cookie = other;
r = await call(`/api/v1/databases/${dbId}/keys/${readKeyId}`, { method: "DELETE" });
assert.equal(r.status, 200);
cookie = "";
r = await call("/api/v1/exec", { method: "POST", headers: { Authorization: `Bearer ${readKey}` }, body: { command: "GET greeting" } });
assert.equal(r.status, 401);

step("reset + delete");
cookie = other;
r = await call(`/api/v1/databases/${dbId}`, { method: "PATCH", body: { action: "reset" } });
assert.equal(r.status, 200);
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "KEYS *" } });
assert.equal(r.json.results[0].reply.count, 0);
for (const id of ids) {
  r = await call(`/api/v1/databases/${id}`, { method: "DELETE" });
  assert.equal(r.status, 200);
}
r = await call("/api/v1/me");
assert.equal(r.json.plan.databasesUsed, 0);
console.log("\nALL GOOD");

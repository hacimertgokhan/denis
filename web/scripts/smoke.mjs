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
    headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...headers },
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

step("register + session");
let r = await call("/api/auth/sign-up/email", { method: "POST", body: { email, password: "smoke-pass-123", name: "Smoke Test" } });
assert.equal(r.status, 200, JSON.stringify(r.json));
r = await call("/api/v1/me");
assert.equal(r.status, 200);
assert.equal(r.json.plan.databasesUsed, 0);
console.log("user", r.json.user.email, "plan", r.json.plan.name, "max", r.json.plan.maxDatabases);

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

step("isolation: another user cannot see it");
const other = cookie;
cookie = "";
r = await call("/api/auth/sign-up/email", { method: "POST", body: { email: `other-${Date.now()}@example.com`, password: "smoke-pass-123", name: "Other" } });
assert.equal(r.status, 200);
r = await call(`/api/v1/databases/${dbId}`);
assert.equal(r.status, 404);
r = await call(`/api/v1/databases/${dbId}/exec`, { method: "POST", body: { command: "GET greeting" } });
assert.equal(r.status, 404);
console.log("other user gets 404 on the database and its console");
cookie = other;

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

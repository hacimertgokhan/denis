"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisCloud, DenisError } = require("../index.js");

/** A fake gateway: records requests and answers like /api/v1/exec and /api/v1/token do. */
function fakeGateway({ scope = "write", expireAccessAfter = Infinity } = {}) {
  const calls = [];
  let issued = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const engine = (line) => {
    const [verb, key, ...rest] = line.split(" ");
    if (verb === "SET") return scope === "read" ? null : { ok: true, message: "Ok (Cache)" };
    if (verb === "GET") return key === "greeting" ? { ok: true, key, data: "hello world" } : { ok: false, error: "not found" };
    if (verb === "SQL") return { ok: true, type: "rows", columns: ["n"], rows: [{ n: 1 }], count: 1 };
    if (verb === "PING") return { ok: true, message: "PONG" };
    return { ok: false, error: `unknown ${verb} ${rest.join(" ")}` };
  };
  const fetch = async (url, init) => {
    const auth = init.headers.Authorization || "";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, auth, body });
    const path = new URL(url).pathname;
    if (path === "/api/v1/token") {
      if (body.apiKey !== "dk_test" && body.refreshToken !== `refresh-${issued}`) return json(401, { error: { code: "UNAUTHORIZED", message: "Invalid credential" } });
      issued += 1;
      return json(200, { accessToken: `access-${issued}`, refreshToken: `refresh-${issued}`, expiresIn: 900, tokenType: "Bearer" });
    }
    const token = auth.replace("Bearer ", "");
    const accessOk = /^access-(\d+)$/.test(token) && Number(token.split("-")[1]) > expireAccessAfter - 1;
    if (token !== "dk_test" && !accessOk) return json(401, { error: { code: "UNAUTHORIZED", message: "Invalid credential" } });
    if (path === "/api/v1/usage") return json(200, { database: { id: "db1", name: "shop" }, scope, usage: { persistedKeys: 3 }, limits: { maxKeys: 50000 } });
    if (path === "/api/v1/exec" && init.method === "GET") return json(200, { database: { id: "db1", name: "shop" }, scope, via: "api-key" });
    if (path === "/api/v1/exec") {
      if (body.commands) return json(200, { results: body.commands.map((c) => ({ command: c, reply: engine(c) ?? { ok: false, error: "Read-only", code: "READ_ONLY" }, latencyMs: 0 })) });
      const reply = engine(body.command);
      if (!reply) return json(403, { error: { code: "READ_ONLY", message: "Read-only access; SET is a write" } });
      return json(200, { reply, latencyMs: 0.2 });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
  };
  return { fetch, calls };
}

test("commands go through /api/v1/exec with the key as Bearer", async () => {
  const gw = fakeGateway();
  const denis = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test/", fetch: gw.fetch });
  assert.equal(denis.url, "https://cloud.test");
  assert.equal(await denis.set("greeting", "hello world", { persist: true }), true);
  assert.equal(await denis.get("greeting"), "hello world");
  assert.equal(await denis.get("missing"), null);
  assert.deepEqual(await denis.query("SELECT 1 AS n"), [{ n: 1 }]);
  assert.equal(await denis.ping(), true);
  assert.equal(gw.calls[0].auth, "Bearer dk_test");
  assert.equal(gw.calls[0].body.command, "SET greeting hello world -&cache -&save");
  assert.equal(gw.calls[2].body.command, "GET missing");
});

test("batch, whoami and usage", async () => {
  const gw = fakeGateway();
  const denis = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test", fetch: gw.fetch });
  const replies = await denis.batch(["GET greeting", "GET missing"]);
  assert.equal(replies[0].data, "hello world");
  assert.equal(replies[1].ok, false);
  assert.equal((await denis.whoami()).database.name, "shop");
  assert.equal((await denis.usage()).limits.maxKeys, 50000);
  await assert.rejects(denis.batch([]), (e) => e instanceof DenisError && e.code === "EINVAL");
});

test("gateway errors become DenisError with the HTTP status and code", async () => {
  const gw = fakeGateway({ scope: "read" });
  const denis = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test", fetch: gw.fetch });
  await assert.rejects(denis.set("k", "v"), (e) => e instanceof DenisError && e.code === "ESERVER" && e.reply.status === 403 && e.reply.code === "READ_ONLY");
  const bad = new DenisCloud({ apiKey: "dk_wrong", url: "https://cloud.test", fetch: gw.fetch });
  await assert.rejects(bad.get("greeting"), (e) => e.code === "EAUTH");
  assert.throws(() => new DenisCloud({ url: "https://cloud.test", fetch: gw.fetch }), (e) => e.code === "EINVAL");
});

test("useJwt exchanges the key once and refreshes when the token dies", async () => {
  const gw = fakeGateway({ expireAccessAfter: 2 }); // only access-2 and later are accepted
  const denis = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test", fetch: gw.fetch, useJwt: true });
  assert.equal(await denis.get("greeting"), "hello world");
  const auths = gw.calls.map((c) => c.auth);
  // token exchange (no auth), exec with access-1 -> 401, refresh, exec with access-2
  assert.deepEqual(auths, ["", "Bearer access-1", "", "Bearer access-2"]);
  assert.equal(gw.calls[0].body.apiKey, "dk_test");
  assert.equal(gw.calls[2].body.refreshToken, "refresh-1");
  await denis.get("greeting");
  assert.equal(gw.calls.at(-1).auth, "Bearer access-2", "cached token reused");
});

test("network failures and timeouts are ECONN / ETIMEOUT", async () => {
  const down = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test", fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(down.get("k"), (e) => e.code === "ECONN");
  const slow = new DenisCloud({
    apiKey: "dk_test",
    url: "https://cloud.test",
    timeout: 20,
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  await assert.rejects(slow.get("k"), (e) => e.code === "ETIMEOUT");
});

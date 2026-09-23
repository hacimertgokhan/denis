"use strict";

/**
 * ConnectionManager against a fake TCP server, using the real denis-client
 * package (whatever version is installed), plus stub-client tests for the
 * parts that do not depend on the network.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisClient } = require("denis-client");
const { ConnectionManager } = require("../../src/main/connection");
const { FakeDenis } = require("../helpers/fake-denis");

const quiet = { info() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function manager(options = {}) {
  return new ConnectionManager({
    createClient: (o) => new DenisClient(o),
    options: { heartbeatMs: 0, reconnectDelays: [50, 50, 100], connectTimeout: 1000, commandTimeout: 2000, ...options },
    logger: quiet,
  });
}

async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(25);
  }
  throw new Error("condition not met in time");
}

test("connects, reports version/admin/project and runs commands", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  const states = [];
  m.on("status", (s) => states.push(s.state));
  const status = await m.connect({ host: "127.0.0.1", port, group: "studio", token: "tok1", name: "fake" }, "pw");
  assert.equal(status.state, "connected");
  assert.equal(status.version, "0.1.0-fake");
  assert.equal(status.admin, true);
  assert.equal(status.project, "tok1");
  assert.deepEqual(states.slice(0, 2), ["connecting", "connected"]);

  await m.run((api) => api.set("greeting", "hello world", { persist: true, ttl: 60 }));
  assert.equal(await m.run((api) => api.get("greeting")), "hello world");
  assert.equal(await m.run((api) => api.get("missing")), null);
  const [meta] = await m.run((api) => api.keyMeta(["greeting"]));
  assert.equal(meta.cache, true);
  assert.equal(meta.persistent, true);
  assert.equal(meta.ttl, 60);
  const keys = await m.run((api) => api.keys("gree*", { limit: 10 }));
  assert.deepEqual(keys.keys, ["greeting"]);
  const q = await m.run((api) => api.query("SELECT * FROM t WHERE name = ?", ["Bob"]));
  assert.deepEqual(q.columns, ["id", "name"]);
  assert.deepEqual(q.rows, [[1, "Bob"]]);
  assert.equal(typeof m.getStatus().latencyMs, "number");
  // no password ever appears in anything but the LIN line
  assert.ok(server.lines.filter((l) => l.includes("pw")).every((l) => l.startsWith("LIN ")));
});

test("server errors keep their code (SQL, NOTFOUND handled, FORBIDDEN)", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  await m.connect({ host: "127.0.0.1", port, group: "user", token: "tok1" }, "u");
  assert.equal(m.getStatus().admin, false);
  await assert.rejects(m.run((api) => api.query("BAD SQL")), (e) => e.code === "SQL" && /Syntax/.test(e.message));
  await assert.rejects(m.run((api) => api.backup()), (e) => e.code === "FORBIDDEN");
  await assert.rejects(m.run((api) => api.set("k", "a -&b")), (e) => e.code === "EINVAL");
  assert.equal(m.getStatus().state, "connected", "server errors do not drop the connection");
});

test("wrong password -> error state with AUTH code", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  await assert.rejects(m.connect({ host: "127.0.0.1", port, group: "studio" }, "wrong"), (e) => e.code === "AUTH");
  assert.equal(m.getStatus().state, "error");
  assert.equal(m.getStatus().error.code, "AUTH");
});

test("unreachable server -> ECONN-like error", async () => {
  const server = new FakeDenis();
  const port = await server.start();
  await server.stop(); // free port, nothing listening
  const m = manager();
  await assert.rejects(m.connect({ host: "127.0.0.1", port, group: "studio" }, "pw"), (e) => typeof e.code === "string");
  assert.equal(m.getStatus().state, "error");
});

test("a stale default project token still connects (without project) and warns", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  const status = await m.connect({ host: "127.0.0.1", port, group: "studio", token: "gone" }, "pw");
  assert.equal(status.state, "connected");
  assert.equal(status.project, null);
  assert.match(status.warning, /Default project could not be opened/);
});

test("test() does HELLO + LIN and closes again", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  t.after(() => server.stop());
  const m = manager();
  const r = await m.test({ host: "127.0.0.1", port, group: "studio", token: "tok1" }, "pw");
  assert.equal(r.version, "0.1.0-fake");
  assert.equal(r.admin, true);
  assert.equal(r.project, "tok1");
  const r2 = await m.test({ host: "127.0.0.1", port, group: "studio", token: "nope" }, "pw");
  assert.match(r2.projectError, /Cannot auth/);
  await assert.rejects(m.test({ host: "127.0.0.1", port, group: "studio" }, "bad"), (e) => e.code === "AUTH");
  assert.equal(m.getStatus().state, "disconnected");
});

test("use() switches the project for the whole session; deleting it resets", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  await m.connect({ host: "127.0.0.1", port, group: "studio" }, "pw");
  assert.equal(m.getStatus().project, null);
  const token = await m.run((api) => api.createProject());
  await m.use(token);
  assert.equal(m.getStatus().project, token);
  // several parallel commands (several pooled connections) all see the project
  const results = await Promise.all([1, 2, 3, 4].map((i) => m.run((api) => api.set(`k${i}`, "v"))));
  assert.equal(results.length, 4);
  const size = await m.run((api) => api.dbsize());
  assert.equal(size.keys, 4);
  await m.deleteProject(token);
  assert.equal(m.getStatus().project, null);
  await assert.rejects(m.run((api) => api.get("k1")), (e) => e.code === "NOPROJECT");
});

test("reconnects after a server restart", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  await m.connect({ host: "127.0.0.1", port, group: "studio", token: "tok1" }, "pw");
  const events = [];
  m.on("status", (s) => events.push(s.state));
  await server.stop();
  await assert.rejects(m.run((api) => api.ping()));
  await waitFor(() => m.getStatus().state === "reconnecting");
  await sleep(150);
  await server.start(port);
  await waitFor(() => m.getStatus().state === "connected");
  assert.ok(events.includes("reconnecting"));
  assert.equal(m.getStatus().project, "tok1", "project restored after reconnect");
  assert.equal(typeof (await m.run((api) => api.ping())), "number");
});

test("relogin() switches group for the whole session", async (t) => {
  const server = new FakeDenis();
  const port = await server.start();
  const m = manager();
  t.after(async () => {
    await m.disconnect();
    await server.stop();
  });
  await m.connect({ host: "127.0.0.1", port, group: "studio" }, "pw");
  await m.relogin("user", "u");
  assert.equal(m.getStatus().group, "user");
  assert.equal(m.getStatus().admin, false);
  await assert.rejects(m.relogin("user", "bad"), (e) => e.code === "AUTH");
  assert.equal(m.getStatus().group, "user", "failed relogin keeps the old session");
});

test("stub client: use() falls back to reconnecting when the client cannot switch", async () => {
  const created = [];
  const stub = (o) => {
    const client = {
      options: o,
      closed: false,
      async connect() {},
      async close() {
        this.closed = true;
      },
      async command(line) {
        if (line === "HELLO") return { ok: true, version: "x", protocol: 2 };
        if (line === "WHOAMI") return { ok: true, group: o.group, admin: false, project: o.token || null };
        return { ok: true };
      },
    };
    created.push(client);
    return client;
  };
  const m = new ConnectionManager({ createClient: stub, options: { heartbeatMs: 0 }, logger: quiet });
  await m.connect({ host: "h", port: 1, group: "g" }, "p");
  await m.use("tokX");
  assert.equal(m.getStatus().project, "tokX");
  assert.equal(created.length, 2);
  assert.equal(created[0].closed, true);
  assert.equal(created[1].options.token, "tokX");
  assert.equal(created[1].options.password, "p");
  await m.disconnect();
  assert.equal(m.getStatus().state, "disconnected");
  await assert.rejects(m.run((api) => api.ping()), (e) => e.code === "NOTCONNECTED");
});

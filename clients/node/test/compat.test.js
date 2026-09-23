"use strict";

// The 0.5 API (DenisCommands, structured SQL, admin(), error codes) and the
// 1.1 additions, against the in-process fake server (no real server needed):
//   node --test test/compat.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisClient, DenisCloud, DenisCommands, DenisError } = require("../index.js");
const { fakeServer, sleep, MAIN_TOKEN } = require("./fake-server.js");

function clientFor(fake, options = {}) {
  return new DenisClient({
    port: fake.port,
    group: "ci",
    password: "pass word",
    token: "tok0",
    reconnect: { retries: 2, minDelay: 10, maxDelay: 20 },
    ...options,
  });
}

async function withClient(t, options, fn) {
  const fake = await fakeServer();
  const client = clientFor(fake, options);
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  return fn(client, fake);
}

/** A transport that only implements command(), like a 0.5 subclass of DenisCommands. */
class ScriptedCommands extends DenisCommands {
  constructor(replies) {
    super();
    this.replies = replies;
    this.lines = [];
  }

  async command(line) {
    this.lines.push(line);
    const reply = typeof this.replies === "function" ? this.replies(line) : this.replies[line.split(" ")[0]];
    return reply === undefined ? { ok: true } : reply;
  }
}

// ======================================================================= 0.5 API over TCP

test("0.5 flow: key-value, info, help, save and structured SQL", async (t) => {
  await withClient(t, { token: undefined, createProject: true, poolSize: 3 }, async (denis) => {
    assert.equal(await denis.ping(), true);
    assert.ok(denis.token, "a project token was created");

    assert.equal(await denis.set("k", "hello world with spaces"), true);
    assert.equal(await denis.get("k"), "hello world with spaces");
    assert.equal(await denis.del("k"), true);
    assert.equal(await denis.get("k"), null);
    await denis.set("o", { a: 1, b: [true, "x y"] });
    assert.deepEqual(await denis.getJSON("o"), { a: 1, b: [true, "x y"] });
    assert.equal(await denis.update("o", "two"), true);
    assert.equal(await denis.get("o"), "two");
    assert.equal(await denis.clear(), true);
    assert.equal(await denis.get("o"), null);

    await denis.set("k_a", "1");
    await denis.set("k_b", "2", { persist: true });
    assert.equal(await denis.exists("k_a"), true);
    assert.equal(await denis.exists("k_zzz"), false);
    assert.deepEqual(await denis.keys("k_?"), ["k_a", "k_b"]);
    assert.deepEqual(await denis.mget(["k_a", "k_nope"]), { k_a: "1", k_nope: null });

    const info = await denis.info();
    assert.equal(info.ok, undefined);
    assert.equal(typeof info.version, "string");
    assert.ok(info.connections.open >= 1);
    assert.equal(info.project.quota.maxKeys, 0, "project usage and quota at the top level");
    assert.equal(info.info.server.protocol, 2, "the 0.1 sections are kept under info");
    const help = await denis.help();
    assert.ok(help.some((c) => c.name === "SQL" && typeof c.needsLogin === "boolean"));
    assert.equal(await denis.save(), true);

    const created = await denis.sql("CREATE TABLE users (id INT, name TEXT)");
    assert.equal(created.type, "affected");
    assert.equal(created.affected, 0);
    assert.equal(await denis.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')"), 1);
    assert.equal(await denis.execute("INSERT INTO users (id, name) VALUES (2, 'Grace')"), 1);
    assert.deepEqual(await denis.query("SELECT name FROM users WHERE id = 2"), [{ name: "Grace" }]);
    const rows = await denis.sql("SELECT * FROM users");
    assert.equal(rows.type, "rows");
    assert.deepEqual(rows.columns, ["id", "name"]);
    assert.deepEqual(rows.rows[0], { id: 1, name: "Ada" });
    assert.equal(rows.count, 2);
    const described = await denis.describe("users");
    assert.equal(described.rows, 2);
    assert.deepEqual(described.columns.map((c) => c.name), ["id", "name"]);
    assert.ok((await denis.tables()).some((tbl) => tbl.name === "users"));
    assert.equal(await denis.describe("no_such_table"), null);
    await assert.rejects(denis.sql("SELECT * FROM no_such_table"), (err) => err.code === "ESERVER" && err.serverCode === "SQL" && /not found/.test(err.message));
    assert.equal(await denis.execute("DROP TABLE users"), 0);
  });
});

test("sql/query/execute: SQL <statement> without params, QUERY {sql, params} with them", async (t) => {
  await withClient(t, { poolSize: 1 }, async (denis, fake) => {
    await denis.execute("CREATE TABLE t (id INT, name TEXT)");
    const inserted = await denis.sql("INSERT INTO t (id, name)\nVALUES (?, ?)", [7n, "Robert'); DROP TABLE t; --"]);
    assert.deepEqual(
      { type: inserted.type, affected: inserted.affected, lastRowId: inserted.lastRowId, message: inserted.message },
      { type: "affected", affected: 1, lastRowId: 1, message: "1 row inserted" },
    );
    assert.equal(await denis.execute("INSERT INTO t (id, name) VALUES (?, ?)", [8, "Ada"]), 1);
    assert.deepEqual(await denis.query("SELECT * FROM t WHERE id = ?", [7]), [{ id: 7, name: "Robert'); DROP TABLE t; --" }]);
    assert.deepEqual(await denis.queryObjects("SELECT name FROM t WHERE id = ?", [8]), [{ name: "Ada" }]);
    // multi-line SQL goes through QUERY as soon as params (even []) are given
    assert.equal((await denis.query("SELECT *\nFROM t", [])).length, 2);

    const lines = fake.conns[0].lines.slice(3);
    assert.equal(lines[0], "SQL CREATE TABLE t (id INT, name TEXT)");
    assert.equal(lines[1], 'QUERY {"sql":"INSERT INTO t (id, name)\\nVALUES (?, ?)","params":[7,"Robert\'); DROP TABLE t; --"]}');
    assert.equal(lines.at(-1), 'QUERY {"sql":"SELECT *\\nFROM t","params":[]}');

    // results of the wrong kind are EPROTO
    await assert.rejects(denis.query("SHOW TABLES"), (err) => err.code === "EPROTO" && /expected rows, got tables/.test(err.message));
    await assert.rejects(denis.execute("SELECT * FROM t"), (err) => err.code === "EPROTO" && /expected an affected count/.test(err.message));
    // invalid input never reaches the server
    const invalid = (err) => err instanceof DenisError && err.code === "EINVAL";
    await assert.rejects(denis.sql("SELECT 1\nFROM t"), invalid);
    await assert.rejects(denis.sql(""), invalid);
    await assert.rejects(denis.query("SELECT ?", "nope"), invalid);
    await assert.rejects(denis.describe("bad name"), invalid);
    assert.equal(fake.conns[0].lines.some((l) => l.includes("SELECT 1")), false);
  });
});

test("graph() / queryGraph(): one QUERY line, {data, errors}", async (t) => {
  await withClient(t, { poolSize: 1 }, async (denis, fake) => {
    const doc = `{
      n: count("orders")
      user: get("user:1") { name }
    }`;
    const { data, errors } = await denis.graph(doc);
    assert.equal(data.document, '{       n: count("orders")       user: get("user:1") { name }     }');
    assert.deepEqual(errors, [{ path: "bad", error: "unknown resolver" }]);
    const again = await denis.queryGraph("{ n: count(\"orders\") }");
    assert.equal(again.data.document, '{ n: count("orders") }');
    assert.ok(fake.conns[0].lines.every((l) => !/[\r\n]/.test(l)));
    await assert.rejects(denis.graph("  "), (err) => err.code === "EINVAL");
    await assert.rejects(denis.graph("nope"), (err) => err.code === "ESERVER" && /syntax/.test(err.message));
  });
});

test("admin(mainToken): list, create, import, usage, quota, flush, drop", async (t) => {
  await withClient(t, { poolSize: 1 }, async (denis, fake) => {
    const admin = denis.admin(MAIN_TOKEN);
    const list = await admin.list();
    assert.ok(Array.isArray(list));
    assert.deepEqual(Object.keys(list[0]).sort(), ["quota", "token", "usage"]);
    const created = await admin.create({ maxKeys: 1, maxBytes: 1000 });
    assert.equal(created.ok, undefined);
    assert.match(created.token, /^adm/);
    assert.equal(typeof created.message, "string");
    assert.equal((await admin.create()).token.startsWith("adm"), true);
    assert.deepEqual(await admin.import("restored", { maxKeys: 5, maxBytes: 0 }), { message: "Project imported", token: "restored", added: true });
    assert.equal((await admin.import("restored")).added, false, "idempotent");
    const usage = await admin.usage(created.token);
    assert.deepEqual(usage.quota, { maxKeys: 1, maxBytes: 1000 });
    assert.equal(usage.usage.cachedKeys, 0);
    const quota = await admin.quota(created.token, 10, 0);
    assert.deepEqual(quota.quota, { maxKeys: 10, maxBytes: 0 });
    assert.equal(await admin.flush(created.token), true);
    assert.equal(await admin.drop(created.token), true);
    assert.deepEqual(fake.conns[0].lines.filter((l) => l.startsWith("ADMIN")).map((l) => l.split(" ").slice(2).join(" ")), [
      "LIST",
      "CREATE 1 1000",
      "CREATE",
      "IMPORT restored 5 0",
      "IMPORT restored",
      `USAGE ${created.token}`,
      `QUOTA ${created.token} 10 0`,
      `FLUSH ${created.token}`,
      `DROP ${created.token}`,
    ]);

    await assert.rejects(denis.admin("wrong").list(), (err) => err.code === "ESERVER" && err.message === "ADMIN refused: wrong main token");
    await assert.rejects(admin.usage("missing"), (err) => err.code === "ESERVER" && /Unknown project/.test(err.message));
    await assert.rejects(admin.usage("two words"), (err) => err.code === "EINVAL");
    await assert.rejects(admin.quota("x", -1, 0), (err) => err.code === "EINVAL");
    assert.throws(() => denis.admin(""), (err) => err.code === "EINVAL");
  });
});

test("errors: 0.5 codes (EAUTH, ESERVER) with the server's code in serverCode", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.close());
  // an unknown token: EAUTH, with the message the platform uses to restore projects
  const missing = clientFor(fake, { token: "gone" });
  await assert.rejects(missing.command("PING"), (err) => err.code === "EAUTH" && err.serverCode === "AUTH" && /Cannot auth with|Unknown project/.test(err.message));
  await missing.close();
  const badLogin = clientFor(fake, { password: "nope" });
  await assert.rejects(badLogin.ping(), (err) => err instanceof DenisError && err.code === "EAUTH" && /Login failed/.test(err.message));
  await badLogin.close();

  // a quota refusal keeps its fields in err.reply
  const admin = clientFor(fake, { token: undefined });
  const { token } = await admin.admin(MAIN_TOKEN).create({ maxKeys: 1, maxBytes: 0 });
  const limited = clientFor(fake, { token });
  await limited.set("a", "1");
  await assert.rejects(limited.set("b", "2"), (err) => err.code === "ESERVER" && err.serverCode === "QUOTA" && err.reply.resource === "keys" && err.reply.limit === 1);
  await limited.close();
  await admin.close();
});

// ======================================================================= pool behaviour

test("pool: connections open on demand and grow while busy; connect() opens all", async (t) => {
  await withClient(t, { poolSize: 3 }, async (denis, fake) => {
    assert.equal(await denis.ping(), true);
    await sleep(20);
    assert.equal(fake.conns.length, 1, "one command, one connection");
    // a burst while the connection is busy opens one more connection at a time
    const first = Promise.all(Array.from({ length: 12 }, (_, i) => denis.command(`DELAY 30 r${i}`)));
    await sleep(20);
    assert.equal(fake.conns.length, 2);
    const second = Promise.all(Array.from({ length: 12 }, (_, i) => denis.command(`DELAY 5 s${i}`)));
    await Promise.all([first, second]);
    assert.equal(fake.conns.length, 3, "grew to poolSize while commands were in flight");
    await Promise.all(Array.from({ length: 30 }, (_, i) => denis.command(`DELAY 5 t${i}`)));
    assert.equal(fake.conns.length, 3, "never beyond poolSize");
  });
  await withClient(t, { poolSize: 3 }, async (denis, fake) => {
    await denis.connect();
    assert.equal(fake.conns.length, 3);
  });
});

test("pool: pipeline: false keeps one command in flight per connection (0.5 option)", async (t) => {
  await withClient(t, { poolSize: 2, pipeline: false }, async (denis, fake) => {
    assert.equal(denis.options.maxPending, 1);
    const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => denis.command(`DELAY 5 r${i}`)));
    assert.deepEqual(replies.map((r) => r.data), Array.from({ length: 8 }, (_, i) => `r${i}`));
    assert.equal(fake.conns.length, 2);
    assert.ok(fake.conns.every((c) => c.maxOutstanding <= 3), "handshake lines aside, one command at a time");
    assert.ok(fake.conns.every((c) => c.lines.some((l) => l.startsWith("DELAY"))), "both connections were used");
  });
});

test("batch(): raw lines in one write, replies in order (ok:false included)", async (t) => {
  await withClient(t, { poolSize: 2 }, async (denis) => {
    const replies = await denis.batch(["SET a 1", "GET a", "GET missing", "NOPE"]);
    assert.equal(replies.length, 4);
    assert.equal(replies[1].data, "1");
    assert.equal(replies[2].code, "NOTFOUND");
    assert.equal(replies[3].ok, false);
    await assert.rejects(denis.batch([]), (err) => err.code === "EINVAL");
    await assert.rejects(denis.batch(["PING", "a\nb"]), (err) => err.code === "EINVAL");
  });
});

test("pipeline(): the 0.5 commands queue too", async (t) => {
  await withClient(t, { poolSize: 1 }, async (denis) => {
    await denis.execute("CREATE TABLE p (id INT)");
    const results = await denis
      .pipeline()
      .execute("INSERT INTO p (id) VALUES (?)", [1])
      .query("SELECT * FROM p")
      .sql("SHOW TABLES")
      .describe("missing")
      .mget([])
      .graph("{ a: get(\"a\") }")
      .help()
      .exec();
    assert.equal(results[0], 1);
    assert.deepEqual(results[1], [{ id: 1 }]);
    assert.equal(results[2].type, "tables");
    assert.equal(results[3], null);
    assert.deepEqual(results[4], {});
    assert.equal(typeof results[5].data.document, "string");
    assert.ok(Array.isArray(results[6]));
  });
});

// ======================================================================= DenisCommands contract

test("DenisCommands: a subclass that implements command() gets the whole API", async () => {
  const denis = new ScriptedCommands({
    PING: { ok: false, error: "nope" },
    GET: { ok: false, key: "x", error: "not found" },
    MGET: { ok: true, values: { a: "1", b: null } },
    DEL: { ok: true, message: "Ok (Cache,Protobuf)." },
    // a 0.1 server: rows as arrays, no type
    SQL: { ok: true, columns: ["id", "name"], rows: [[1, "Ada"]], count: 1, data: "[]" },
    QUERY: { ok: true, message: "1 row inserted", affected: 1, lastRowId: 4, data: "OK: 1 row inserted" },
    INFO: { ok: true, version: "0.5.0", uptimeSeconds: 1 },
  });
  assert.ok(denis instanceof DenisCommands);
  assert.equal(await denis.ping(), false, "ping() is false, not an error, on ok:false");
  assert.equal(await denis.get("x"), null);
  assert.deepEqual(await denis.mget(["a", "b"]), { a: "1", b: null });
  assert.equal(await denis.del("a"), true, "true when the server does not report whether the key existed");
  assert.deepEqual(await denis.query("SELECT * FROM t"), [{ id: 1, name: "Ada" }]);
  assert.deepEqual(await denis.sql("INSERT INTO t (id) VALUES (?)", [4]), { type: "affected", message: "1 row inserted", affected: 1, lastRowId: 4, data: "OK: 1 row inserted" });
  assert.deepEqual(await denis.info(), { version: "0.5.0", uptimeSeconds: 1 });
  assert.deepEqual(denis.lines, ["PING", "GET x", "MGET a b", "DEL a", "SQL SELECT * FROM t", 'QUERY {"sql":"INSERT INTO t (id) VALUES (?)","params":[4]}', "INFO"]);
  await assert.rejects(new DenisCommands().ping(), (err) => err.code === "EINVAL" && /not implemented/.test(err.message));
  assert.equal(typeof denis.pipeline, "undefined", "pipelines are a TCP feature");
});

test("DenisCloud: import() stays below the gateway's 64 KB command limit", async () => {
  const sent = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.command);
    return new Response(JSON.stringify({ reply: { ok: true, imported: { persistent: 0, cache: Object.keys(JSON.parse(body.command.slice(7)).cache || {}).length, tables: 0, rows: 0 } } }), { status: 200 });
  };
  const denis = new DenisCloud({ apiKey: "dk_test", url: "https://cloud.test", fetch });
  const cache = {};
  for (let i = 0; i < 400; i++) cache[`k${i}`] = "x".repeat(500);
  const imported = await denis.import({ cache });
  assert.equal(imported.cache, 400);
  assert.ok(sent.length > 2);
  assert.ok(sent.every((line) => Buffer.byteLength(line) < 64 * 1024));
});

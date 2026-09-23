"use strict";

// Runs against a live Denis server whose DENIS_GROUP is an admin group, e.g.:
//   docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=ci -e DENIS_BOOTSTRAP_GROUP_PASSWORD=ci-password denis:local
//   npm run test:integration        (or DENIS_INTEGRATION=1 node --test test/integration.test.js)
// Environment: DENIS_HOST, DENIS_PORT, DENIS_GROUP, DENIS_PASSWORD (defaults 127.0.0.1, 5142, ci, ci-password),
// DENIS_MAIN_TOKEN (the server's ddb-main-token; the admin() tests are skipped without it).
// Without DENIS_INTEGRATION=1 the suite is skipped so `npm test` stays green offline.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisClient, DenisError } = require("../index.js");

const enabled = process.env.DENIS_INTEGRATION === "1" || process.env.npm_lifecycle_event === "test:integration";
const mainToken = process.env.DENIS_MAIN_TOKEN;
const options = {
  host: process.env.DENIS_HOST || "127.0.0.1",
  port: Number(process.env.DENIS_PORT || 5142),
  group: process.env.DENIS_GROUP || "ci",
  password: process.env.DENIS_PASSWORD || "ci-password",
  createProject: true,
  poolSize: 3,
};

test("denis integration", { skip: !enabled && "set DENIS_INTEGRATION=1 with a running server" }, async (t) => {
  const denis = new DenisClient(options);
  const created = [];
  const key = `t_${Date.now()}`;

  await t.test("connect, ping, hello, whoami", async () => {
    assert.equal(await denis.connect(), denis);
    assert.equal(await denis.ping(), true);
    assert.ok(denis.token, "a project token was created");
    created.push(denis.token);
    const hello = await denis.hello();
    assert.equal(hello.server, "denis");
    assert.equal(hello.protocol, 2);
    assert.ok(hello.features.includes("sql-params"));
    const who = await denis.whoami();
    assert.deepEqual(who, { group: options.group, admin: true, project: denis.token });
  });

  await t.test("set / get / del", async () => {
    assert.equal(await denis.set(key, "hello world with spaces"), true);
    assert.equal(await denis.get(key), "hello world with spaces");
    assert.equal(await denis.exists(key), true);
    assert.equal(await denis.del(key), true);
    assert.equal(await denis.del(key), false);
    assert.equal(await denis.get(key), null);
    assert.equal(await denis.exists(key), false);
  });

  await t.test("unicode, quotes, empty values and trailing whitespace round-trip", async () => {
    for (const value of ['say "hi" — çğüşöı ✓ 😀', "", "trailing  ", "  leading", "a  b", "tab\tinside"]) {
      await denis.set(key, value);
      assert.equal(await denis.get(key), value, JSON.stringify(value));
    }
    await denis.update(key, "updated ");
    assert.equal(await denis.get(key), "updated ");
  });

  await t.test("objects round-trip through JSON", async () => {
    await denis.set(key, { a: 1, b: [true, "x y"] });
    assert.deepEqual(await denis.getJSON(key), { a: 1, b: [true, "x y"] });
  });

  await t.test("persist writes the durable layer; flags are not part of the value", async () => {
    await denis.set(key, "persisted value", { persist: true });
    assert.equal(await denis.get(key), "persisted value");
    assert.equal(await denis.get(key, { source: "cache" }), "persisted value");
    assert.equal(await denis.del(key, { cache: true }), true);
    assert.equal(await denis.get(key, { source: "protobuf" }), "persisted value");
    assert.deepEqual(await denis.keys(key, { layer: "persistent" }), [key]);
    assert.deepEqual(await denis.keys(key, { layer: "cache" }), []);
    await denis.del(key);
  });

  await t.test("ttl, expire, persist", async () => {
    await denis.set(key, "v", { ttl: 100 });
    const ttl = await denis.ttl(key);
    assert.ok(ttl > 90 && ttl <= 100, `ttl ${ttl}`);
    assert.equal(await denis.persist(key), true);
    assert.equal(await denis.ttl(key), -1);
    assert.equal(await denis.expire(key, 50), true);
    assert.ok((await denis.ttl(key)) <= 50);
    assert.equal(await denis.ttl(`${key}_missing`), -2);
    assert.equal(await denis.expire(`${key}_missing`, 5), false);
    await denis.set(`${key}_short`, "x", { ttl: 0.2 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await denis.get(`${key}_short`), null);
  });

  await t.test("incr / decr", async () => {
    assert.equal(await denis.incr(`${key}_n`), 1);
    assert.equal(await denis.incr(`${key}_n`, 10), 11);
    assert.equal(await denis.decr(`${key}_n`), 10);
    assert.equal(await denis.decr(`${key}_n`, 4, { persist: true }), 6);
    assert.equal(await denis.get(`${key}_n`, { source: "protobuf" }), "6");
    await denis.set(`${key}_text`, "abc");
    await assert.rejects(denis.incr(`${key}_text`), (err) => err instanceof DenisError && err.code === "ESERVER" && err.serverCode === "TYPE");
  });

  await t.test("keys, mget, dbsize, clear", async () => {
    await denis.clear();
    await Promise.all([denis.set("user:1", "Ada"), denis.set("user:2", "Linus"), denis.set("order:1", "x", { persist: true })]);
    assert.deepEqual(await denis.keys("user:*"), ["user:1", "user:2"], "sorted");
    assert.deepEqual(await denis.keys("user:?"), ["user:1", "user:2"]);
    assert.equal((await denis.keys("*", { limit: 1 })).length, 1);
    assert.deepEqual(await denis.mget(["user:1", "nope", "order:1"]), { "user:1": "Ada", nope: null, "order:1": "x" });
    assert.deepEqual(await denis.mget([]), {});
    const size = await denis.dbsize();
    assert.ok(size.keys >= 3 && size.cache >= 3 && size.persistent >= 1, JSON.stringify(size));
    assert.equal(await denis.clear(), true);
    assert.equal(await denis.get("user:1"), null);
    assert.equal(await denis.get("order:1"), "x", "durable values survive HEAVEN");
  });

  await t.test("sql: structured results (0.5 API)", async () => {
    const created = await denis.sql("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score REAL)");
    assert.equal(created.type, "affected");
    assert.equal(await denis.execute("INSERT INTO users (id, name, score) VALUES (1, 'Ada', 9.5)"), 1);
    assert.deepEqual(await denis.query("SELECT name FROM users WHERE id = 1"), [{ name: "Ada" }]);
    const rows = await denis.sql("SELECT * FROM users");
    assert.equal(rows.type, "rows");
    assert.deepEqual(rows.columns, ["id", "name", "score"]);
    assert.deepEqual(rows.rows, [{ id: 1, name: "Ada", score: 9.5 }]);
    assert.equal(rows.count, 1);
    const tables = await denis.tables();
    const users = tables.find((tbl) => tbl.name === "users");
    assert.equal(users.rows, 1);
    assert.deepEqual(users.columns.map((c) => c.name), ["id", "name", "score"]);
    const described = await denis.describe("users");
    assert.equal(described.name, "users");
    assert.equal(described.columns[0].type, "INTEGER");
    assert.equal(await denis.describe("no_such_table"), null);
    const show = await denis.sql("SHOW TABLES");
    assert.equal(show.type, "tables");
    await assert.rejects(denis.sql("SELECT * FROM no_such_table"), (err) => err.code === "ESERVER" && err.serverCode === "SQL" && /not found/.test(err.message));
    await assert.rejects(denis.query("SHOW TABLES"), (err) => err.code === "EPROTO");
  });

  await t.test("sql: bound parameters through QUERY {sql, params}", async () => {
    const inserted = await denis.sql("INSERT INTO users (id, name, score)\nVALUES (?, ?, ?)", [2, "Robert'); DROP TABLE users; --", 7]);
    assert.equal(inserted.type, "affected");
    assert.equal(inserted.affected, 1);
    assert.equal(typeof inserted.lastRowId, "number");
    assert.equal(await denis.execute("UPDATE users SET score = ? WHERE id = ?", [8, 2]), 1);
    assert.deepEqual(await denis.query("SELECT id, name FROM users WHERE id >= ? ORDER BY id", [1]), [
      { id: 1, name: "Ada" },
      { id: 2, name: "Robert'); DROP TABLE users; --" },
    ]);
    assert.deepEqual(await denis.queryObjects("SELECT name, score FROM users WHERE id = ?", [1]), [{ name: "Ada", score: 9.5 }]);
    assert.deepEqual(await denis.query("SELECT COUNT(*) AS n\nFROM users", []), [{ n: 2 }]);
    await assert.rejects(denis.query("SELECT * FROM nope WHERE id = ?", [1]), (err) => err.serverCode === "SQL" && /nope/i.test(err.message));
  });

  await t.test("graph: GraphQL-shaped QUERY document", async () => {
    await denis.set("gq:user", { name: "Ada", email: "ada@example.com", address: { city: "London" } });
    const { data, errors } = await denis.graph(`{
      user: get("gq:user") { name address { city } }
      n: count("users")
      has: exists("gq:user")
      top: table("users", order: "id desc", limit: 1) { id name }
      broken: count("no_such_table")
    }`);
    assert.deepEqual(data.user, { name: "Ada", address: { city: "London" } });
    assert.equal(data.n, 2);
    assert.equal(data.has, true);
    assert.deepEqual(data.top, [{ id: 2, name: "Robert'); DROP TABLE users; --" }]);
    assert.equal(data.broken, null);
    assert.ok(errors.some((e) => e.path === "broken"));
    assert.equal((await denis.queryGraph('{ n: count("users") }')).data.n, 2);
    await assert.rejects(denis.graph("{ nope"), (err) => err.code === "ESERVER" && /syntax/i.test(err.message));
  });

  await t.test("pipeline: results in order, failures as DenisError instances", async () => {
    const results = await denis
      .pipeline()
      .set(`${key}_p`, "1")
      .get(`${key}_p`)
      .incr(`${key}_p`)
      .get(`${key}_missing`)
      .set(`${key}_q`, "text")
      .incr(`${key}_q`)
      .query("SELECT COUNT(*) AS n FROM users")
      .describe("no_such_table")
      .exec();
    assert.deepEqual(results.slice(0, 5), [true, "1", 2, null, true]);
    assert.ok(results[5] instanceof DenisError);
    assert.equal(results[5].serverCode, "TYPE");
    assert.deepEqual(results[6], [{ n: 2 }]);
    assert.equal(results[7], null);
    const replies = await denis.batch(["PING", `GET ${key}_p`, "NOSUCHCOMMAND"]);
    assert.equal(replies[1].data, "2");
    assert.equal(replies[2].ok, false);
  });

  await t.test("many concurrent commands are multiplexed over the pool", async () => {
    const n = 2000;
    await Promise.all(Array.from({ length: n }, (_, i) => denis.set(`${key}_${i}`, `v${i}`)));
    const reads = await Promise.all(Array.from({ length: n }, (_, i) => denis.get(`${key}_${i}`)));
    assert.deepEqual(reads, Array.from({ length: n }, (_, i) => `v${i}`));
    const values = await denis.mget(Array.from({ length: 100 }, (_, i) => `${key}_${i}`));
    assert.equal(Object.keys(values).length, 100);
  });

  await t.test("dump and import into another project (also split into chunks)", async () => {
    await denis.set(`${key}_ttl`, "expiring", { ttl: 300 });
    await denis.set(`${key}_durable`, "durable ✓", { persist: true });
    const dump = await denis.dump();
    assert.equal(dump.ok, undefined);
    assert.equal(dump.format, 1);
    assert.ok(dump.tables.users);
    assert.equal(dump.cache[`${key}_ttl`], "expiring");
    assert.ok(dump.ttl[`${key}_ttl`] > 0);

    for (const chunkBytes of [undefined, 4096]) {
      const target = await denis.createProject();
      created.push(target);
      const copy = new DenisClient({ ...options, createProject: false, token: target, poolSize: 1 });
      try {
        const imported = await copy.import(dump, { chunkBytes });
        assert.equal(imported.tables, Object.keys(dump.tables).length);
        assert.equal(imported.rows, dump.tables.users.rows.length);
        assert.equal(imported.cache, Object.keys(dump.cache).length);
        assert.equal(imported.persistent, Object.keys(dump.persistent).length);
        assert.equal(await copy.get(`${key}_durable`, { source: "protobuf" }), "durable ✓");
        assert.ok((await copy.ttl(`${key}_ttl`)) > 0);
        assert.deepEqual(await copy.query("SELECT name FROM users ORDER BY id"), [{ name: "Ada" }, { name: "Robert'); DROP TABLE users; --" }]);
        // importing the same table again needs replace
        await assert.rejects(copy.import({ tables: dump.tables }), (err) => err.serverCode === "SQL");
        assert.equal((await copy.import({ tables: dump.tables }, { replace: true })).tables, 1);
      } finally {
        await copy.close();
      }
    }
  });

  await t.test("projects: create, list, use, delete", async () => {
    const original = denis.token;
    const other = await denis.createProject();
    assert.equal(denis.token, original, "createProject does not switch");
    const list = await denis.projects();
    assert.ok(list.some((p) => p.token === other && p.current === false));
    assert.ok(list.some((p) => p.token === original));

    await denis.use(other);
    assert.equal(denis.token, other);
    assert.equal((await denis.dbsize()).keys, 0);
    await denis.set("only-here", "1");
    // every pooled connection switched
    const whos = await Promise.all(Array.from({ length: 6 }, () => denis.whoami()));
    assert.ok(whos.every((w) => w.project === other));

    await denis.use(original);
    assert.equal(await denis.get("only-here"), null);
    assert.equal(await denis.deleteProject(other), true);
    assert.equal((await denis.projects()).some((p) => p.token === other), false);
    await assert.rejects(denis.use(other), (err) => err.code === "EAUTH");
    assert.equal(denis.token, original);
  });

  await t.test("info, help, save and admin-group commands", async () => {
    const info = await denis.info();
    assert.equal(info.ok, undefined);
    assert.equal(typeof info.version, "string");
    assert.equal(typeof info.uptimeSeconds, "number");
    assert.ok(info.connections.open >= 1);
    assert.equal(typeof info.project.cachedKeys, "number");
    assert.equal(typeof info.project.quota.maxKeys, "number");
    assert.equal(info.info.server.protocol, 2);
    assert.ok(info.info.stats.commands > 0);
    const help = await denis.help();
    assert.ok(help.some((c) => c.name === "SQL" && typeof c.usage === "string"));
    assert.equal(await denis.save(), true);
    const saved = await denis.command("SAVE");
    assert.equal(saved.ok, true);
    const backup = await denis.backup({ timeout: 60000 });
    assert.match(backup.name, /\.zip$/);
    const { backups, directory } = await denis.backups();
    assert.equal(typeof directory, "string");
    assert.ok(backups.some((b) => b.name === backup.name));
  });

  await t.test("admin(mainToken): projects, usage, quota, import, flush, drop", { skip: !mainToken && "set DENIS_MAIN_TOKEN" }, async () => {
    const plain = new DenisClient({ host: options.host, port: options.port, poolSize: 1 }); // no login needed
    try {
      const admin = plain.admin(mainToken);
      const { token } = await admin.create({ maxKeys: 2, maxBytes: 0 });
      assert.ok(token);
      assert.ok((await admin.list()).some((p) => p.token === token));
      const usage = await admin.usage(token);
      assert.deepEqual(usage.quota, { maxKeys: 2, maxBytes: 0 });
      assert.equal(usage.usage.cachedKeys, 0);

      const user = new DenisClient({ ...options, createProject: false, token, poolSize: 1 });
      try {
        await user.set("a", "1");
        await user.set("b", "2");
        await assert.rejects(user.set("c", "3"), (err) => err.code === "ESERVER" && err.serverCode === "QUOTA" && err.reply.limit === 2 && /quota exceeded/.test(err.message));
        assert.equal((await admin.quota(token, 10, 0)).quota.maxKeys, 10);
        await user.set("c", "3");
        assert.equal((await admin.usage(token)).usage.cachedKeys, 3);
        assert.equal(await admin.flush(token), true);
        assert.equal(await user.get("a"), null);
      } finally {
        await user.close();
      }

      // the platform's recovery: a token the engine does not know is EAUTH ("Cannot auth with"), ADMIN IMPORT restores it
      const lost = `lost${Date.now()}${"x".repeat(100)}`;
      const orphan = new DenisClient({ ...options, createProject: false, token: lost, poolSize: 1 });
      await assert.rejects(orphan.ping(), (err) => err.code === "EAUTH" && /Cannot auth with|Unknown project/.test(err.message));
      await orphan.close();
      assert.equal((await admin.import(lost, { maxKeys: 5, maxBytes: 0 })).added, true);
      assert.equal((await admin.import(lost)).added, false);
      const restored = new DenisClient({ ...options, createProject: false, token: lost, poolSize: 1 });
      await restored.set("k", "v");
      assert.equal(await restored.get("k"), "v");
      await restored.close();

      assert.equal(await admin.drop(lost), true);
      assert.equal(await admin.drop(token), true);
      assert.equal((await admin.list()).some((p) => p.token === token), false);
      await assert.rejects(plain.admin("wrong").list(), (err) => err.code === "ESERVER" && /ADMIN refused: wrong main token/.test(err.message));
    } finally {
      await plain.close();
    }
  });

  await t.test("a second client can reuse the created token", async () => {
    const other = new DenisClient({ ...options, createProject: false, token: denis.token });
    await other.set(key, "shared");
    assert.equal(await denis.get(key), "shared");
    await other.close();
  });

  await t.test("the pool opens connections on demand", async () => {
    const lazy = new DenisClient({ ...options, createProject: false, token: denis.token, poolSize: 3 });
    let connects = 0;
    lazy.on("connect", () => connects++);
    await lazy.ping();
    assert.equal(connects, 1);
    await lazy.close();
  });

  await t.test("a connection closed by the server is re-established", async () => {
    const single = new DenisClient({ ...options, createProject: false, token: denis.token, poolSize: 1 });
    let connects = 0;
    single.on("connect", () => connects++);
    await single.set(`${key}_r`, "before");
    const bye = await single.command("EXIT");
    assert.equal(bye.ok, true);
    // the next command waits for the replacement connection instead of hitting the closing one
    assert.equal(await single.get(`${key}_r`), "before");
    assert.equal(connects, 2);
    await single.close();
  });

  await t.test("errors: 0.5 codes with the server code in serverCode", async () => {
    const bad = new DenisClient({ ...options, password: "nope", createProject: false });
    await assert.rejects(bad.ping(), (err) => err instanceof DenisError && err.code === "EAUTH");
    await bad.close();
    await assert.rejects(denis.set("__sql:x", "1"), (err) => err.code === "ESERVER" && err.serverCode === "RESERVED");
    const reply = await denis.command("NOSUCHCOMMAND");
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "UNKNOWN");
    assert.match(reply.error, /try HELP/);
    const noProject = new DenisClient({ ...options, createProject: false, poolSize: 1 });
    await assert.rejects(noProject.get("x"), (err) => err.code === "ESERVER" && err.serverCode === "NOPROJECT");
    await noProject.close();
  });

  await t.test("invalid keys and values are rejected locally", async () => {
    await assert.rejects(denis.get("has space"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.set(key, "line\nbreak"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.set(key, "a -&save b"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.sql("SELECT 1\nFROM users"), (err) => err.code === "EINVAL");
  });

  await t.test("cleanup", async () => {
    await denis.execute("DROP TABLE users");
    for (const token of created) await denis.deleteProject(token).catch(() => {});
    await denis.close();
    await assert.rejects(denis.ping(), (err) => err.code === "ECLOSED");
  });
});

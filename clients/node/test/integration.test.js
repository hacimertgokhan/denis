"use strict";

// Runs against a live Denis server whose DENIS_GROUP is an admin group, e.g.:
//   docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=ci -e DENIS_BOOTSTRAP_GROUP_PASSWORD=ci-password denis:local
//   npm run test:integration        (or DENIS_INTEGRATION=1 node --test test/)
// Environment: DENIS_HOST, DENIS_PORT, DENIS_GROUP, DENIS_PASSWORD (defaults 127.0.0.1, 5142, ci, ci-password).
// Without DENIS_INTEGRATION=1 the suite is skipped so `npm test` stays green offline.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisClient, DenisError } = require("../index.js");

const enabled = process.env.DENIS_INTEGRATION === "1" || process.env.npm_lifecycle_event === "test:integration";
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
    await assert.rejects(denis.incr(`${key}_text`), (err) => err instanceof DenisError && err.code === "TYPE");
  });

  await t.test("keys, mget, dbsize, clear", async () => {
    await denis.clear();
    await Promise.all([denis.set("user:1", "Ada"), denis.set("user:2", "Linus"), denis.set("order:1", "x", { persist: true })]);
    assert.deepEqual((await denis.keys("user:*")).sort(), ["user:1", "user:2"]);
    assert.equal((await denis.keys("*", { limit: 1 })).length, 1);
    assert.deepEqual(await denis.mget(["user:1", "nope", "order:1"]), { "user:1": "Ada", nope: null, "order:1": "x" });
    const size = await denis.dbsize();
    assert.ok(size.keys >= 3 && size.cache >= 3 && size.persistent >= 1, JSON.stringify(size));
    assert.equal(await denis.clear(), true);
    assert.equal(await denis.get("user:1"), null);
    assert.equal(await denis.get("order:1"), "x", "durable values survive HEAVEN");
  });

  await t.test("sql (legacy text) and query with bound parameters", async () => {
    assert.match(await denis.sql("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score REAL)"), /OK/);
    assert.match(await denis.sql("INSERT INTO users (id, name, score) VALUES (1, 'Ada', 9.5)"), /OK/);
    assert.match(await denis.sql("SELECT * FROM users WHERE id = 1"), /Ada/);

    const inserted = await denis.query("INSERT INTO users (id, name, score)\nVALUES (?, ?, ?)", [2, "Robert'); DROP TABLE users; --", 7]);
    assert.equal(inserted.affected, 1);
    assert.equal(inserted.lastRowId !== null, true);

    const result = await denis.query("SELECT id, name FROM users WHERE id >= ? ORDER BY id", [1]);
    assert.deepEqual(result.columns, ["id", "name"]);
    assert.deepEqual(result.rows, [[1, "Ada"], [2, "Robert'); DROP TABLE users; --"]]);
    assert.equal(result.count, 2);

    const objects = await denis.queryObjects("SELECT name, score FROM users WHERE id = ?", [1]);
    assert.deepEqual(objects, [{ name: "Ada", score: 9.5 }]);

    await assert.rejects(denis.query("SELECT * FROM nope"), (err) => err.code === "SQL" && /nope/i.test(err.message));
    await assert.rejects(denis.sql("SELECT * FROM nope"), (err) => err.code === "SQL");
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
      .exec();
    assert.deepEqual(results.slice(0, 5), [true, "1", 2, null, true]);
    assert.ok(results[5] instanceof DenisError);
    assert.equal(results[5].code, "TYPE");
    assert.deepEqual(results[6].rows, [[2]]);
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
        assert.deepEqual((await copy.query("SELECT name FROM users ORDER BY id")).rows, [["Ada"], ["Robert'); DROP TABLE users; --"]]);
        // importing the same table again needs replace
        await assert.rejects(copy.import({ tables: dump.tables }), (err) => err.code === "SQL");
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
    await assert.rejects(denis.use(other), (err) => err.code === "AUTH");
    assert.equal(denis.token, original);
  });

  await t.test("info and admin commands", async () => {
    const info = await denis.info();
    assert.equal(info.server.protocol, 2);
    assert.ok(info.stats.commands > 0);
    assert.ok(info.project);
    const saved = await denis.save();
    assert.ok(saved.bytes >= 0 && typeof saved.millis === "number");
    const backup = await denis.backup({ timeout: 60000 });
    assert.match(backup.name, /\.zip$/);
    const { backups, directory } = await denis.backups();
    assert.equal(typeof directory, "string");
    assert.ok(backups.some((b) => b.name === backup.name));
  });

  await t.test("a second client can reuse the created token", async () => {
    const other = new DenisClient({ ...options, createProject: false, token: denis.token });
    await other.set(key, "shared");
    assert.equal(await denis.get(key), "shared");
    await other.close();
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

  await t.test("errors carry the server code", async () => {
    const bad = new DenisClient({ ...options, password: "nope", createProject: false });
    await assert.rejects(bad.ping(), (err) => err instanceof DenisError && err.code === "AUTH");
    await bad.close();
    await assert.rejects(denis.set("__sql:x", "1"), (err) => err.code === "RESERVED");
    const reply = await denis.command("NOSUCHCOMMAND");
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "UNKNOWN");
    const noProject = new DenisClient({ ...options, createProject: false, poolSize: 1 });
    await assert.rejects(noProject.get("x"), (err) => err.code === "NOPROJECT");
    await noProject.close();
  });

  await t.test("invalid keys and values are rejected locally", async () => {
    await assert.rejects(denis.get("has space"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.set(key, "line\nbreak"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.set(key, "a -&save b"), (err) => err.code === "EINVAL");
  });

  await t.test("cleanup", async () => {
    for (const token of created) await denis.deleteProject(token).catch(() => {});
    await denis.close();
    await assert.rejects(denis.ping(), (err) => err.code === "ECLOSED");
  });
});

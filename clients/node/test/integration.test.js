"use strict";

// Runs against a live server (see the Dockerfile at the repo root):
//   docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=crm -e DENIS_BOOTSTRAP_GROUP_PASSWORD=s3cret denis:local
//   DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret node --test test/
// Without DENIS_INTEGRATION=1 the suite is skipped so `npm test` stays green offline.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DenisClient, DenisError } = require("../index.js");

const enabled = process.env.DENIS_INTEGRATION === "1";
const options = {
  host: process.env.DENIS_HOST || "127.0.0.1",
  port: Number(process.env.DENIS_PORT || 5142),
  group: process.env.DENIS_GROUP || "denis",
  password: process.env.DENIS_PASSWORD || "change-me",
  createProject: true,
  poolSize: 3,
};

test("denis integration", { skip: !enabled && "set DENIS_INTEGRATION=1 with a running server" }, async (t) => {
  const denis = new DenisClient(options);
  const key = `t_${Date.now()}`;

  await t.test("ping and login", async () => {
    assert.equal(await denis.ping(), true);
    assert.ok(denis.token, "a project token was created");
  });

  await t.test("set / get / del in the cache", async () => {
    await denis.set(key, "hello world with spaces");
    assert.equal(await denis.get(key), "hello world with spaces");
    await denis.del(key);
    assert.equal(await denis.get(key), null);
  });

  await t.test("values with quotes and unicode survive json mode", async () => {
    const value = 'say "hi" — çğüşöı ✓';
    await denis.set(key, value);
    assert.equal(await denis.get(key), value);
  });

  await t.test("objects round-trip through JSON", async () => {
    await denis.set(key, { a: 1, b: [true, "x y"] });
    assert.deepEqual(await denis.getJSON(key), { a: 1, b: [true, "x y"] });
  });

  await t.test("flags are not stored as part of the value", async () => {
    await denis.set(key, "persisted value", { persist: true });
    assert.equal(await denis.get(key), "persisted value");
    assert.equal(await denis.get(key, { source: "protobuf" }), "persisted value");
    await denis.del(key);
  });

  await t.test("update overwrites the cache", async () => {
    await denis.set(key, "one");
    await denis.update(key, "two");
    assert.equal(await denis.get(key), "two");
  });

  await t.test("clear drops the project's cached keys", async () => {
    await denis.set(key, "gone");
    await denis.clear();
    assert.equal(await denis.get(key), null);
  });

  await t.test("exists, keys and mget", async () => {
    await denis.set(`${key}_a`, "1");
    await denis.set(`${key}_b`, "2", { persist: true });
    assert.equal(await denis.exists(`${key}_a`), true);
    assert.equal(await denis.exists(`${key}_zzz`), false);
    const keys = await denis.keys(`${key}_?`);
    assert.deepEqual(keys, [`${key}_a`, `${key}_b`]);
    assert.deepEqual(await denis.mget([`${key}_a`, `${key}_nope`]), { [`${key}_a`]: "1", [`${key}_nope`]: null });
    await denis.del(`${key}_a`);
    await denis.del(`${key}_b`);
  });

  await t.test("info, help and save", async () => {
    const info = await denis.info();
    assert.equal(typeof info.version, "string");
    assert.ok(info.connections.open >= 1);
    const help = await denis.help();
    assert.ok(help.some((c) => c.name === "SQL"));
    assert.equal(await denis.save(), true);
  });

  await t.test("sql returns structured results", async () => {
    const table = `t${Date.now()}`;
    assert.equal((await denis.sql(`CREATE TABLE ${table} (id INT, name TEXT)`)).type, "affected");
    assert.equal(await denis.execute(`INSERT INTO ${table} (id, name) VALUES (1, 'Ada'), (2, 'Grace')`), 2);
    assert.deepEqual(await denis.query(`SELECT name FROM ${table} WHERE id = 2`), [{ name: "Grace" }]);
    const rows = await denis.sql(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 1`);
    assert.equal(rows.type, "rows");
    assert.deepEqual(rows.columns, ["id", "name"]);
    assert.equal(rows.rows[0].id, 2);
    const described = await denis.describe(table);
    assert.equal(described.rows, 2);
    assert.deepEqual(described.columns.map((c) => c.name), ["id", "name"]);
    assert.ok((await denis.tables()).some((tbl) => tbl.name === table));
    assert.equal(await denis.describe("no_such_table"), null);
    await assert.rejects(denis.sql("SELECT * FROM no_such_table"), (err) => err.code === "ESERVER" && /not found/.test(err.message));
    assert.equal(await denis.execute(`DROP TABLE ${table}`), 0);
  });

  await t.test("parallel commands share the pool in order", async () => {
    const writes = [];
    for (let i = 0; i < 20; i++) writes.push(denis.set(`${key}_${i}`, `v${i}`));
    await Promise.all(writes);
    const reads = await Promise.all(Array.from({ length: 20 }, (_, i) => denis.get(`${key}_${i}`)));
    assert.deepEqual(reads, Array.from({ length: 20 }, (_, i) => `v${i}`));
  });

  await t.test("second client can reuse the created token", async () => {
    const other = new DenisClient({ ...options, createProject: false, token: denis.token });
    await other.set(key, "shared");
    assert.equal(await denis.get(key), "shared");
    await other.close();
  });

  await t.test("wrong password is an EAUTH error", async () => {
    const bad = new DenisClient({ ...options, password: "nope", createProject: false });
    await assert.rejects(bad.ping(), (err) => err instanceof DenisError && err.code === "EAUTH");
    await bad.close();
  });

  await t.test("invalid keys and values are rejected locally", async () => {
    await assert.rejects(denis.get("has space"), (err) => err.code === "EINVAL");
    await assert.rejects(denis.set(key, "line\nbreak"), (err) => err.code === "EINVAL");
  });

  await denis.close();
});

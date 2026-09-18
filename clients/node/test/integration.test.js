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

  await t.test("sql subset works", async () => {
    assert.match(await denis.sql("CREATE TABLE users (id INT, name TEXT)"), /OK/);
    assert.match(await denis.sql("INSERT INTO users (id, name) VALUES (1, 'Ada')"), /OK/);
    assert.match(await denis.sql("SELECT * FROM users WHERE id = 1"), /Ada/);
    assert.match(await denis.sql("DROP TABLE users"), /OK/);
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

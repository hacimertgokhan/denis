"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../../src/main/dumpfile");

const DUMP = {
  ok: true,
  format: 1,
  server: "denis",
  version: "0.1.0-alpha",
  createdAt: "2026-09-23T18:04:41Z",
  cache: { a: "hello world", b: '{"x":1}', c: "5" },
  persistent: { b: '{"x":1}', c: "5" },
  ttl: { a: 99886 },
  tables: {
    users: {
      columns: [
        { name: "id", type: "INTEGER", primaryKey: true, notNull: true },
        { name: "name", type: "TEXT" },
      ],
      indexes: [{ name: "idx_name", column: "name", unique: false }],
      rows: [
        [1, "Ada"],
        [2, null],
      ],
    },
  },
};

test("wrapDump adds metadata, drops ok and shortens the token", () => {
  const token = "7dMs9h2f3NsrEJhNnNmUcpXxgy47m3p9PpwQjIvQz4Q1zHxr2AFmPxTUhXlkCTTztV1xQtA4Hg63s1krwCMtx5xXpMplyOy9O2x0U6iKpiAlHIbNe0q71N6CHgvVvvh5";
  const file = d.wrapDump(DUMP, { host: "h", port: 1, group: "g", project: token, studioVersion: "0.1.0", now: new Date("2026-01-02T03:04:05Z") });
  assert.equal(file.kind, "denis-studio-export");
  assert.equal(file.formatVersion, 1);
  assert.equal(file.exportedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(file.source.project, "7dMs9h2f…vvh5");
  assert.ok(!JSON.stringify(file).includes(token), "full token is not in the file");
  assert.equal("ok" in file.dump, false);
  assert.deepEqual(file.summary, { keys: 3, cacheKeys: 3, persistentKeys: 2, ttlKeys: 1, tables: 1, rows: 2 });
});

test("serialize -> parse round trip", () => {
  const file = d.wrapDump(DUMP, {});
  const parsed = d.parseDumpFile(d.serialize(file));
  assert.deepEqual(parsed.dump.cache, DUMP.cache);
  assert.deepEqual(parsed.dump.tables, DUMP.tables);
  assert.equal(parsed.summary.rows, 2);
  assert.equal(parsed.summary.tableList[0].indexes, 1);
  assert.ok(parsed.meta.exportedAt);
});

test("a raw DUMP reply (and a BOM) is accepted", () => {
  const parsed = d.parseDumpFile("﻿" + JSON.stringify(DUMP));
  assert.equal(parsed.meta, null);
  assert.equal(parsed.summary.keys, 3);
});

test("invalid files are rejected with clear messages", () => {
  const bad = [
    ["not json", /not valid JSON/],
    ["[]", /JSON object/],
    ['{"hello":1}', /not a Denis export/],
    [JSON.stringify({ kind: "denis-studio-export", formatVersion: 99, dump: {} }), /unsupported export format/],
    [JSON.stringify({ cache: { "two words": "x" } }), /not one word/],
    [JSON.stringify({ cache: { a: { nested: true } } }), /must be a string/],
    [JSON.stringify({ cache: [] }), /"cache" must be an object/],
    [JSON.stringify({ ttl: { a: -1 } }), /non-negative/],
    [JSON.stringify({ tables: { t: { rows: [] } } }), /no "columns"/],
    [JSON.stringify({ tables: { t: { columns: [{ name: "a", type: "TEXT" }], rows: [1] } } }), /row 0 is not an array/],
    [JSON.stringify({ tables: { "bad name": { columns: [{ name: "a", type: "TEXT" }] } } }), /table name/],
    [JSON.stringify({ format: 2, cache: {} }), /unsupported dump format/],
  ];
  for (const [text, re] of bad) {
    assert.throws(() => d.parseDumpFile(text), (e) => e.code === "EFORMAT" && re.test(e.message), text);
  }
});

test("suggestFileName is filesystem friendly", () => {
  const name = d.suggestFileName("ab/cd:ef-12345678", new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(name, "denis-abcdef12-20260102-030405.denis.json");
  assert.match(d.suggestFileName(null), /^denis-project-\d{8}-\d{6}\.denis\.json$/);
});

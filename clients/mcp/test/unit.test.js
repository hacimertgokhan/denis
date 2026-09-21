import test from "node:test";
import assert from "node:assert/strict";
import { isReadOnlySql, schemaToMarkdown } from "../src/tools.js";
import { rowsToMarkdown, truncate, CHARACTER_LIMIT } from "../src/format.js";
import { loadConfig } from "../src/config.js";

test("read-only statements are recognised", () => {
  assert.equal(isReadOnlySql("SELECT * FROM t"), true);
  assert.equal(isReadOnlySql("  select 1 from t"), true);
  assert.equal(isReadOnlySql("SQL SHOW TABLES"), true);
  assert.equal(isReadOnlySql("DESCRIBE users"), true);
  assert.equal(isReadOnlySql("INSERT INTO t (a) VALUES (1)"), false);
  assert.equal(isReadOnlySql("DELETE FROM t"), false);
  assert.equal(isReadOnlySql("DROP TABLE t"), false);
});

test("rows render as a markdown table", () => {
  const md = rowsToMarkdown(["id", "name"], [{ id: 1, name: "Ada" }, { id: 2, name: null }]);
  assert.equal(md, "| id | name |\n| --- | --- |\n| 1 | Ada |\n| 2 | NULL |");
  assert.equal(rowsToMarkdown([], []), "_no rows_");
});

test("schema overview mentions tables and keys", () => {
  const md = schemaToMarkdown({
    server: { version: "0.3.0", uptimeSeconds: 1 },
    project: { cachedKeys: 2, persistedKeys: 1 },
    tables: [{ name: "users", columns: [{ name: "id", type: "INT" }], rows: 3 }],
    keys: { total: 2, sample: ["a"] },
  });
  assert.match(md, /\*\*users\*\* \(3 rows\): id INT/);
  assert.match(md, /- a\n- … 1 more/);
});

test("long text is truncated with a hint", () => {
  const text = truncate("x".repeat(CHARACTER_LIMIT + 10));
  assert.ok(text.length < CHARACTER_LIMIT + 200);
  assert.match(text, /truncated/);
});

test("config requires group and password", () => {
  assert.throws(() => loadConfig({}), /DENIS_GROUP, DENIS_PASSWORD/);
  const config = loadConfig({ DENIS_GROUP: "g", DENIS_PASSWORD: "p", DENIS_READ_ONLY: "1", DENIS_PORT: "6000" });
  assert.equal(config.port, 6000);
  assert.equal(config.readOnly, true);
  assert.equal(config.createProject, true);
});

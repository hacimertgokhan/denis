// Pure renderer modules (no DOM) tested under Node.
import test from "node:test";
import assert from "node:assert/strict";
import { keyError, checkValue, prepareValue, encodeAsJsonString, toEditorText, isIntegerValue, parseTtl, parseStructured } from "../../src/renderer/util/values.js";
import { splitStatements, stripComments, explainOf, parseParams, countPlaceholders, ident, sortRows } from "../../src/renderer/util/sql.js";
import { HistoryNav } from "../../src/renderer/util/history-nav.js";
import { formatBytes, formatDuration, formatTtl, formatPercent, shortToken } from "../../src/renderer/util/format.js";

test("keyError", () => {
  assert.equal(keyError("user:1"), null);
  assert.match(keyError(""), /required/);
  assert.match(keyError("a b"), /one word/);
  assert.match(keyError("-&x"), /-&/);
  assert.match(keyError("__sql:users"), /reserved/);
});

test("checkValue reports each wire problem", () => {
  assert.deepEqual(checkValue("hello world"), { ok: true, problems: [], warnings: [], fixable: false });
  assert.match(checkValue("a\nb").problems.join(), /line breaks/);
  assert.match(checkValue("x -&save").problems.join(), /-&/);
  assert.equal(checkValue(" padded").ok, true, "leading spaces are part of the value");
  const trailing = checkValue("padded ");
  assert.equal(trailing.ok, true);
  assert.match(trailing.warnings.join(), /Trailing spaces/);
  assert.equal(checkValue("").ok, false);
  assert.equal(checkValue("a-&b").ok, true, "-& inside a word is fine");
});

test("encodeAsJsonString is wire safe and round trips", () => {
  const text = "line1\nline2 -&save  end ";
  const encoded = encodeAsJsonString(text);
  assert.equal(checkValue(encoded).ok, true);
  assert.equal(JSON.parse(encoded), text);
});

test("prepareValue: raw, json (compacted), json string", () => {
  assert.deepEqual(prepareValue("plain text", "raw"), { ok: true, value: "plain text" });
  assert.deepEqual(prepareValue('{\n  "a": 1,\n  "b": "x -&y"\n}', "json"), { ok: true, value: '{"a":1,"b":"x -\\u0026y"}' });
  assert.equal(JSON.parse(prepareValue('{"b":"x -&y"}', "json").value).b, "x -&y");
  const bad = prepareValue("{oops", "json");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid JSON/);
  const multi = prepareValue("a\nb", "raw");
  assert.equal(multi.ok, false);
  assert.equal(multi.canEncode, true);
  assert.deepEqual(prepareValue("a\nb", "raw", { asJsonString: true }), { ok: true, value: '"a\\nb"' });
});

test("toEditorText pretty prints objects/arrays only", () => {
  assert.deepEqual(toEditorText('{"a":[1,2]}'), { mode: "json", text: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
  assert.deepEqual(toEditorText("42"), { mode: "raw", text: "42" });
  assert.deepEqual(toEditorText('"str"'), { mode: "raw", text: '"str"' });
  assert.equal(parseStructured("{bad}").ok, false);
});

test("isIntegerValue / parseTtl", () => {
  assert.equal(isIntegerValue("42"), true);
  assert.equal(isIntegerValue("-7"), true);
  assert.equal(isIntegerValue("4.2"), false);
  assert.equal(isIntegerValue("abc"), false);
  assert.deepEqual(parseTtl(""), { ok: true, value: undefined });
  assert.deepEqual(parseTtl("60"), { ok: true, value: 60 });
  assert.equal(parseTtl("0").ok, false);
  assert.equal(parseTtl("1.5").ok, false);
  assert.equal(parseTtl("-1").ok, false);
});

test("splitStatements respects quotes and comments", () => {
  assert.deepEqual(splitStatements("SELECT 1; SELECT 2;"), ["SELECT 1", "SELECT 2"]);
  assert.deepEqual(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT \"x;y\""), ["INSERT INTO t VALUES ('a;b')", 'SELECT "x;y"']);
  assert.deepEqual(splitStatements("SELECT 'it''s; fine'"), ["SELECT 'it''s; fine'"]);
  assert.deepEqual(splitStatements("-- comment; not split\nSELECT 1"), ["-- comment; not split\nSELECT 1"]);
  assert.deepEqual(splitStatements("/* a; b */ SELECT 1; ;  -- only comment"), ["/* a; b */ SELECT 1"]);
  assert.deepEqual(splitStatements("   "), []);
});

test("stripComments / explainOf / ident", () => {
  assert.equal(stripComments("SELECT 1 -- note\n FROM t /* x */ WHERE a = '--no'"), "SELECT 1 \n FROM t   WHERE a = '--no'");
  assert.equal(explainOf("SELECT 1"), "EXPLAIN SELECT 1");
  assert.equal(explainOf("explain SELECT 1"), "explain SELECT 1");
  assert.equal(ident("users"), "users");
  assert.equal(ident("my table"), '"my table"');
});

test("parseParams / countPlaceholders", () => {
  assert.deepEqual(parseParams(""), { ok: true, value: [] });
  assert.deepEqual(parseParams('[1, "a", null]'), { ok: true, value: [1, "a", null] });
  assert.equal(parseParams("{}").ok, false);
  assert.equal(parseParams("[1,").ok, false);
  assert.equal(countPlaceholders("SELECT * FROM t WHERE a = ? AND b = '?' -- ?\n AND c = ?"), 2);
});

test("sortRows: numbers, strings, NULLs last in both directions, stable", () => {
  const rows = [[3, "b"], [null, "a"], [10, "c"], [1, null], [3, "a"]];
  assert.deepEqual(sortRows(rows, 0, "asc").map((r) => r[0]), [1, 3, 3, 10, null]);
  assert.deepEqual(sortRows(rows, 0, "desc").map((r) => r[0]), [10, 3, 3, 1, null]);
  assert.deepEqual(sortRows(rows, 0, "asc").filter((r) => r[0] === 3).map((r) => r[1]), ["b", "a"], "stable");
  assert.deepEqual(sortRows([["item10"], ["item2"]], 0).map((r) => r[0]), ["item2", "item10"]);
  assert.deepEqual(sortRows(rows, 1, "desc").map((r) => r[1]), ["c", "b", "a", "a", null]);
});

test("HistoryNav behaves like a shell", () => {
  const nav = new HistoryNav(["third", "second", "first"]);
  assert.equal(nav.up("draft"), "third");
  assert.equal(nav.up(""), "second");
  assert.equal(nav.up(""), "first");
  assert.equal(nav.up(""), null);
  assert.equal(nav.down(), "second");
  assert.equal(nav.down(), "third");
  assert.equal(nav.down(), "draft");
  assert.equal(nav.down(), null);
  assert.equal(new HistoryNav([]).up("x"), null);
});

test("formatting", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB");
  assert.equal(formatDuration(93784), "1d 2h 3m");
  assert.equal(formatDuration(59), "59s");
  assert.equal(formatTtl(-1), "no TTL");
  assert.equal(formatTtl(90), "1m 30s");
  assert.equal(formatPercent(0.5), "50.0%");
  assert.equal(formatPercent(null), "–");
  assert.equal(shortToken("abcdefghijklmnopqrstuvwxyz"), "abcdefgh…wxyz");
});

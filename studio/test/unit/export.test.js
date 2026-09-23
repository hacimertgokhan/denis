"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toCsv, toJson, toTsv, uniqueColumnNames } = require("../../src/main/export");

test("CSV quoting follows RFC 4180", () => {
  const csv = toCsv(["id", "text"], [
    [1, "plain"],
    [2, "with, comma"],
    [3, 'say "hi"'],
    [4, "line\nbreak"],
    [5, " padded "],
    [6, null],
    [7, true],
    [8, { a: 1 }],
  ]);
  assert.equal(
    csv,
    'id,text\r\n1,plain\r\n2,"with, comma"\r\n3,"say ""hi"""\r\n4,"line\nbreak"\r\n5," padded "\r\n6,\r\n7,true\r\n8,"{""a"":1}"\r\n',
  );
});

test("CSV guards against formula injection for text, not numbers", () => {
  const csv = toCsv(["v"], [["=SUM(A1)"], ["+1"], ["@x"], [-5], ["-x"]]);
  assert.equal(csv, "v\r\n'=SUM(A1)\r\n'+1\r\n'@x\r\n-5\r\n'-x\r\n");
  const raw = toCsv(["v"], [["=1"]], { escapeFormulas: false });
  assert.equal(raw, "v\r\n=1\r\n");
});

test("CSV options: BOM, no header, delimiter", () => {
  assert.equal(toCsv(["a"], [[1]], { bom: true }), "﻿a\r\n1\r\n");
  assert.equal(toCsv(["a", "b"], [[1, 2]], { header: false }), "1,2\r\n");
  assert.equal(toCsv(["a", "b"], [[1, "x;y"]], { delimiter: ";" }), 'a;b\r\n1;"x;y"\r\n');
  assert.equal(toCsv(["a"], []), "a\r\n");
});

test("JSON export: objects per row, duplicate columns made unique", () => {
  assert.deepEqual(uniqueColumnNames(["id", "id", "name", "id"]), ["id", "id_2", "name", "id_3"]);
  const json = JSON.parse(toJson(["id", "id", "v"], [[1, 2, null]]));
  assert.deepEqual(json, [{ id: 1, id_2: 2, v: null }]);
});

test("TSV for the clipboard flattens tabs and line breaks", () => {
  assert.equal(toTsv(["a", "b"], [["x\ty", "l1\nl2"]]), "a\tb\nx y\tl1 l2");
  assert.equal(toTsv(["a"], [[null]], { header: false }), "");
});

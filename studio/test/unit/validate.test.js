"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../../src/main/validate");

test("str: type, length, line breaks, pattern", () => {
  assert.equal(v.str()("x", "a"), "x");
  assert.throws(() => v.str()(1, "a"), /a must be a string/);
  assert.throws(() => v.str({ min: 1 })("", "a"), /must not be empty/);
  assert.throws(() => v.str({ max: 2 })("abc", "a"), /at most 2/);
  assert.throws(() => v.str({ noLineBreaks: true })("a\nb", "a"), /line breaks/);
  assert.equal(v.str({ optional: true })(undefined, "a"), undefined);
  assert.equal(v.str({ trim: true })("  x ", "a"), "x");
});

test("int / num / bool / oneOf", () => {
  assert.equal(v.int({ min: 1 })(5, "n"), 5);
  assert.throws(() => v.int()(1.5, "n"), /integer/);
  assert.throws(() => v.int({ max: 3 })(4, "n"), /between/);
  assert.throws(() => v.num()(NaN, "n"), /number/);
  assert.throws(() => v.bool()("true", "b"), /boolean/);
  assert.throws(() => v.oneOf(["a", "b"])("c", "x"), /one of/);
});

test("obj is strict and rejects prototypes", () => {
  const check = v.obj({ a: v.int(), b: v.str({ optional: true }) });
  assert.deepEqual(check({ a: 1 }, "o"), { a: 1 });
  assert.throws(() => check({ a: 1, c: 2 }, "o"), /unknown property "c"/);
  assert.throws(() => check([], "o"), /must be an object/);
  assert.throws(() => check(null, "o"), /must be an object/);
  class X {
    constructor() {
      this.a = 1;
    }
  }
  assert.throws(() => check(new X(), "o"), /plain object/);
});

test("arr validates items and bounds", () => {
  const check = v.arr(v.int(), { max: 2 });
  assert.deepEqual(check([1, 2], "l"), [1, 2]);
  assert.throws(() => check([1, 2, 3], "l"), /at most 2/);
  assert.throws(() => check([1, "x"], "l"), /l\[1\] must be an integer/);
});

test("jsonValue bounds depth and rejects functions", () => {
  const check = v.jsonValue({ maxDepth: 2 });
  assert.deepEqual(check([1, "a", null, true, { x: 1 }], "p"), [1, "a", null, true, { x: 1 }]);
  assert.throws(() => check([[[[1]]]], "p"), /nested too deeply/);
  assert.throws(() => check(() => 1, "p"), /not JSON/);
  assert.throws(() => check(Infinity, "p"), /finite/);
});

test("domain validators: key, host, token, color, password", () => {
  assert.equal(v.key()("user:1", "k"), "user:1");
  assert.throws(() => v.key()("two words", "k"), /one word/);
  assert.throws(() => v.key()("tab\there", "k"), /one word/);
  assert.throws(() => v.key()("", "k"), /empty/);
  assert.equal(v.host()("db.example.com", "h"), "db.example.com");
  assert.equal(v.host()("::1", "h"), "::1");
  assert.throws(() => v.host()("a b", "h"), /host/);
  assert.throws(() => v.host()("http://x/", "h"), /host/);
  assert.throws(() => v.token()("a b", "t"), /token/);
  assert.equal(v.color()("#aabbcc", "c"), "#aabbcc");
  assert.throws(() => v.color()("#abc", "c"), /color/);
  assert.equal(v.password()("with spaces ok", "p"), "with spaces ok");
  assert.throws(() => v.password()("line\nbreak", "p"), /line breaks/);
});

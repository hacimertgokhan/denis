"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { classify, maskSecrets } = require("../../src/main/console-commands");
const { SettingsStore, HistoryStore, SETTINGS_DEFAULTS, HISTORY_MAX } = require("../../src/main/stores");
const security = require("../../src/main/security");

test("console classification", () => {
  assert.equal(classify("   ").kind, "empty");
  assert.equal(classify("mode text").kind, "refuse");
  assert.equal(classify("EXIT").kind, "refuse");
  assert.equal(classify("quit").kind, "refuse");
  assert.deepEqual(classify("LIN admin pass with spaces"), { kind: "lin", line: "LIN admin pass with spaces", group: "admin", password: "pass with spaces" });
  assert.equal(classify("LIN onlygroup").kind, "raw", "incomplete LIN goes to the server for its USAGE reply");
  assert.deepEqual(classify("AUTH tok1"), { kind: "auth-use", line: "AUTH tok1", token: "tok1" });
  assert.equal(classify("auth create").kind, "auth-create");
  assert.deepEqual(classify("AUTH DELETE tok2"), { kind: "auth-delete", line: "AUTH DELETE tok2", token: "tok2" });
  assert.equal(classify("GET k").kind, "raw");
});

test("maskSecrets hides LIN passwords only", () => {
  assert.equal(maskSecrets("LIN admin hunter2"), "LIN admin ********");
  assert.equal(maskSecrets("lin admin a b c"), "lin admin ********");
  assert.equal(maskSecrets("SET k v"), "SET k v");
  assert.equal(maskSecrets("LIN admin"), "LIN admin");
});

function tmp(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "studio-stores-")), name);
}

test("settings: defaults, validation, persistence, bad stored values ignored", () => {
  const file = tmp("settings.json");
  const s = new SettingsStore(file);
  assert.deepEqual(s.get(), SETTINGS_DEFAULTS);
  assert.equal(s.set({ theme: "dark", refreshMs: 5000 }).theme, "dark");
  assert.throws(() => s.set({ theme: "neon" }));
  assert.throws(() => s.set({ refreshMs: 10 }));
  assert.throws(() => s.set({ unknown: 1 }));
  assert.equal(new SettingsStore(file).get().refreshMs, 5000);
  fs.writeFileSync(file, JSON.stringify({ theme: "neon", keyLimit: 50, junk: true }));
  const again = new SettingsStore(file).get();
  assert.equal(again.theme, "system");
  assert.equal(again.keyLimit, 50);
  assert.equal(again.junk, undefined);
});

test("history: most recent first, deduplicated, capped", () => {
  const h = new HistoryStore(tmp("history.json"));
  h.add("sql", "SELECT 1");
  h.add("sql", "SELECT 2");
  assert.deepEqual(h.add("sql", "SELECT 1"), ["SELECT 1", "SELECT 2"]);
  for (let i = 0; i < HISTORY_MAX + 20; i++) h.add("console", `PING ${i}`);
  assert.equal(h.list("console").length, HISTORY_MAX);
  assert.deepEqual(h.clear("sql"), []);
});

test("app protocol only serves files below the renderer root", () => {
  const root = path.join(__dirname, "..", "..", "src", "renderer");
  const ok = security.resolveAppPath(root, "studio://app/views/keys.js");
  assert.equal(ok.file, path.join(root, "views", "keys.js"));
  assert.match(ok.type, /javascript/);
  assert.equal(security.resolveAppPath(root, "studio://app/").file, path.join(root, "index.html"));
  for (const bad of [
    "studio://app/../main/main.js",
    "studio://app/%2e%2e/main/main.js",
    "studio://app/..%2f..%2fpackage.json",
    "studio://app/views/..%5c..%5cmain%5cmain.js",
    "studio://other/index.html",
    "file:///etc/passwd",
    "studio://app/index.html%00.js",
    "studio://app/data.bin",
    "not a url",
  ]) {
    const r = security.resolveAppPath(root, bad);
    assert.ok(r === null || r.file.startsWith(root + path.sep), bad);
    if (r) assert.ok(!fs.existsSync(r.file) || r.file.startsWith(root + path.sep), bad);
  }
  // URL normalisation turns /../main/main.js into /main/main.js inside the root (a 404), never src/main
  assert.equal(security.resolveAppPath(root, "studio://app/../main/main.js").file, path.join(root, "main", "main.js"));
  assert.equal(security.isAppUrl("studio://app/index.html"), true);
  assert.equal(security.isAppUrl("studio://app.evil/index.html"), false);
  assert.equal(security.isAppUrl("https://example.com"), false);
});

test("CSP is strict", () => {
  assert.match(security.CSP, /default-src 'self'/);
  assert.match(security.CSP, /script-src 'self'(;|$)/);
  assert.doesNotMatch(security.CSP, /unsafe-inline|unsafe-eval|\*/);
  assert.match(security.responseHeaders("text/html")["content-security-policy"], /object-src 'none'/);
});

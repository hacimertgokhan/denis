"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProfileStore } = require("../../src/main/profiles");

/** Fake safeStorage: reversible, but clearly not plain text. */
function fakeSafeStorage({ available = true, backend = "dpapi" } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s, "utf8").toString("hex").split("").reverse().join("")}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith("ENC:")) throw new Error("bad ciphertext");
      return Buffer.from(t.slice(4).split("").reverse().join(""), "hex").toString("utf8");
    },
  };
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profiles-"));
  return path.join(dir, "profiles.json");
}

let n = 0;
const newId = () => `id${++n}`;
const base = { name: "Local", host: "127.0.0.1", port: 5142, group: "studio" };

test("creates, lists and updates profiles", () => {
  const store = new ProfileStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage(), newId });
  const { profile } = store.save({ ...base, token: "abc", color: "#112233" });
  assert.equal(profile.name, "Local");
  assert.equal(profile.token, "abc");
  assert.equal(profile.hasPassword, false);
  assert.equal(store.list().length, 1);

  const updated = store.save({ ...base, id: profile.id, name: "Renamed", port: 7000 }).profile;
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.port, 7000);
  assert.equal(updated.token, "", "token cleared when omitted");
  assert.equal(store.list().length, 1);
});

test("stores the password encrypted, never in plain text", () => {
  const file = tmpFile();
  const store = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage(), newId });
  const { profile, passwordSaved } = store.save(base, { password: "s3cret pass", savePassword: true });
  assert.equal(passwordSaved, true);
  assert.equal(profile.hasPassword, true);
  assert.equal("passwordEnc" in profile, false, "public view has no ciphertext");
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("s3cret"), "plain password must not be on disk");
  assert.equal(store.getPassword(profile.id), "s3cret pass");

  // a fresh store (new process) can read it back
  const again = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage() });
  assert.equal(again.getPassword(profile.id), "s3cret pass");
});

test("keeps the stored password when savePassword is not given, forgets it on false", () => {
  const store = new ProfileStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage(), newId });
  const { profile } = store.save(base, { password: "pw", savePassword: true });
  store.save({ ...base, id: profile.id, name: "x" });
  assert.equal(store.getPassword(profile.id), "pw");
  store.save({ ...base, id: profile.id }, { savePassword: false });
  assert.equal(store.getPassword(profile.id), null);
  assert.equal(store.get(profile.id).hasPassword, false);
});

test("does not persist passwords when encryption is unavailable", () => {
  const file = tmpFile();
  const store = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage({ available: false }), newId });
  assert.equal(store.encryptionAvailable(), false);
  const r = store.save(base, { password: "pw", savePassword: true });
  assert.equal(r.passwordSaved, false);
  assert.match(r.warning, /not saved/);
  assert.equal(store.getPassword(r.profile.id), null);
  assert.ok(!fs.readFileSync(file, "utf8").includes("passwordEnc"));
});

test("treats Linux basic_text backend as unavailable", () => {
  const store = new ProfileStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage({ backend: "basic_text" }), newId });
  assert.equal(store.encryptionAvailable(), false);
  const store2 = new ProfileStore({ filePath: tmpFile(), safeStorage: null, newId });
  assert.equal(store2.encryptionAvailable(), false);
});

test("a ciphertext that cannot be decrypted yields null (asks again)", () => {
  const file = tmpFile();
  const store = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage(), newId });
  const { profile } = store.save(base, { password: "pw", savePassword: true });
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.profiles[0].passwordEnc = Buffer.from("garbage").toString("base64");
  fs.writeFileSync(file, JSON.stringify(data));
  const again = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage() });
  assert.equal(again.getPassword(profile.id), null);
});

test("duplicate copies fields with a unique name; delete removes", () => {
  const store = new ProfileStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage(), newId });
  const { profile } = store.save(base, { password: "pw", savePassword: true });
  const copy = store.duplicate(profile.id);
  assert.notEqual(copy.id, profile.id);
  assert.equal(copy.name, "Local (copy)");
  assert.equal(store.duplicate(profile.id).name, "Local (copy) 2");
  assert.equal(store.getPassword(copy.id), "pw");
  assert.equal(store.delete(copy.id), true);
  assert.equal(store.delete("missing"), false);
  assert.equal(store.list().length, 2);
});

test("validates profile fields", () => {
  const store = new ProfileStore({ filePath: tmpFile(), safeStorage: fakeSafeStorage(), newId });
  assert.throws(() => store.save({ ...base, host: "bad host" }), /host/);
  assert.throws(() => store.save({ ...base, port: 70000 }), /port/);
  assert.throws(() => store.save({ ...base, group: "two words" }), /group/);
  assert.throws(() => store.save({ ...base, name: "" }), /name/);
  assert.throws(() => store.save({ ...base, color: "red" }), /color/);
  assert.throws(() => store.save({ ...base, token: "a b" }), /token/);
  assert.throws(() => store.save({ ...base, extra: 1 }), /unknown property/);
  assert.throws(() => store.save({ ...base, id: "nope" }), /does not exist/);
});

test("a corrupt profiles.json is kept aside and the store starts empty", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{not json");
  const store = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage(), newId });
  assert.deepEqual(store.list(), []);
  assert.match(store.loadError, /not valid JSON/);
  const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".broken-"));
  assert.equal(backups.length, 1);
});

test("unknown stored fields are dropped when loading", () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ version: 1, profiles: [{ id: "a", name: "A", host: "h", port: 1, group: "g", evil: "<script>", password: "plain" }] }));
  const store = new ProfileStore({ filePath: file, safeStorage: fakeSafeStorage() });
  const [p] = store.list();
  assert.equal(p.evil, undefined);
  assert.equal(p.password, undefined);
});

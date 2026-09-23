"use strict";

/**
 * Connection profiles, stored as JSON in `<userData>/profiles.json`.
 *
 * Passwords are never written in clear text: they are encrypted with
 * Electron's `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret /
 * kwallet on Linux). When no real OS-backed encryption is available (for
 * example Linux without a keyring, where Electron falls back to a hard-coded
 * key called "basic_text"), passwords are simply not persisted and the UI asks
 * for them on every connect.
 *
 * All collaborators (fs, safeStorage, id/clock) are injected so the store can
 * be unit-tested without Electron.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const crypto = require("node:crypto");
const v = require("./validate");

const FILE_VERSION = 1;
const DEFAULT_COLOR = "#3b82f6";

/** Validator for profile fields coming from the renderer (password excluded). */
const profileInput = v.obj({
  id: v.id({ optional: true }),
  name: v.str({ min: 1, max: 80, trim: true, noLineBreaks: true }),
  host: v.host(),
  port: v.port(),
  group: v.group(),
  token: v.str({ max: 512, trim: true, optional: true, pattern: /^[A-Za-z0-9_\-.]*$/, patternMessage: "is not a valid project token" }),
  color: v.color({ optional: true }),
});

class ProfileStore {
  /**
   * @param {object} o
   * @param {string} o.filePath                 where profiles.json lives
   * @param {object|null} [o.safeStorage]       Electron safeStorage (or a fake); null = no encryption
   * @param {typeof nodeFs} [o.fs]
   * @param {() => string} [o.newId]
   * @param {() => Date} [o.now]
   */
  constructor({ filePath, safeStorage = null, fs = nodeFs, newId = () => crypto.randomUUID(), now = () => new Date() }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.fs = fs;
    this.newId = newId;
    this.now = now;
    this.profiles = null; // lazy loaded
    this.loadError = null;
  }

  /** True when passwords can be stored encrypted by the operating system. */
  encryptionAvailable() {
    const s = this.safeStorage;
    if (!s || typeof s.isEncryptionAvailable !== "function") return false;
    try {
      if (!s.isEncryptionAvailable()) return false;
      // Linux without a keyring: Electron "encrypts" with a hard-coded key. Treat as unavailable.
      if (typeof s.getSelectedStorageBackend === "function" && s.getSelectedStorageBackend() === "basic_text") return false;
      return true;
    } catch {
      return false;
    }
  }

  _load() {
    if (this.profiles) return this.profiles;
    let text;
    try {
      text = this.fs.readFileSync(this.filePath, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") this.loadError = `Cannot read profiles: ${err.message}`;
      this.profiles = [];
      return this.profiles;
    }
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : Array.isArray(data.profiles) ? data.profiles : [];
      this.profiles = list.filter((p) => p && typeof p === "object" && typeof p.id === "string").map(sanitizeStored);
    } catch (err) {
      // keep the broken file for the user, start empty
      this.loadError = `profiles.json is not valid JSON (${err.message}); a backup was kept`;
      try {
        this.fs.copyFileSync(this.filePath, `${this.filePath}.broken-${this.now().getTime()}`);
      } catch {
        /* ignore */
      }
      this.profiles = [];
    }
    return this.profiles;
  }

  _persist() {
    const body = JSON.stringify({ version: FILE_VERSION, profiles: this.profiles }, null, 2);
    const dir = nodePath.dirname(this.filePath);
    this.fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(tmp, this.filePath);
  }

  /** Public view of a profile: never contains the (encrypted) password. */
  _public(p) {
    const { passwordEnc, ...rest } = p;
    return { ...rest, hasPassword: typeof passwordEnc === "string" && passwordEnc.length > 0 && this.encryptionAvailable() };
  }

  list() {
    return this._load().map((p) => this._public(p));
  }

  get(id) {
    const p = this._load().find((x) => x.id === id);
    return p ? this._public(p) : null;
  }

  /**
   * Create or update a profile.
   * @param {object} input profile fields (validated here)
   * @param {{password?: string, savePassword?: boolean}} [secret]
   *   savePassword=true + password: store it encrypted (if possible);
   *   savePassword=false: forget any stored password;
   *   savePassword undefined: keep what is stored.
   * @returns {{profile: object, passwordSaved: boolean, warning?: string}}
   */
  save(input, secret = {}) {
    const fields = profileInput(input, "profile");
    const list = this._load();
    const time = this.now().toISOString();
    let existing = fields.id ? list.find((p) => p.id === fields.id) : null;
    if (fields.id && !existing) throw new v.ValidationError(`profile ${fields.id} does not exist`);
    const record = existing
      ? { ...existing }
      : { id: this.newId(), createdAt: time };
    record.name = fields.name;
    record.host = fields.host;
    record.port = fields.port;
    record.group = fields.group;
    record.token = fields.token || "";
    record.color = fields.color || record.color || DEFAULT_COLOR;
    record.updatedAt = time;

    let warning;
    if (secret.savePassword === false) {
      delete record.passwordEnc;
    } else if (secret.savePassword === true && typeof secret.password === "string") {
      if (this.encryptionAvailable()) {
        record.passwordEnc = this.safeStorage.encryptString(secret.password).toString("base64");
      } else {
        delete record.passwordEnc;
        warning = "Secure storage is not available on this system; the password was not saved and will be asked on connect.";
      }
    }

    if (existing) {
      list[list.indexOf(existing)] = record;
    } else {
      list.push(record);
    }
    this._persist();
    return { profile: this._public(record), passwordSaved: !!record.passwordEnc && this.encryptionAvailable(), warning };
  }

  delete(id) {
    const list = this._load();
    const index = list.findIndex((p) => p.id === id);
    if (index < 0) return false;
    list.splice(index, 1);
    this._persist();
    return true;
  }

  duplicate(id) {
    const list = this._load();
    const source = list.find((p) => p.id === id);
    if (!source) throw new v.ValidationError(`profile ${id} does not exist`);
    const time = this.now().toISOString();
    const copy = { ...source, id: this.newId(), name: uniqueName(`${source.name} (copy)`, list), createdAt: time, updatedAt: time };
    list.splice(list.indexOf(source) + 1, 0, copy);
    this._persist();
    return this._public(copy);
  }

  /** Decrypted password, or null when none is stored / it cannot be decrypted. */
  getPassword(id) {
    const p = this._load().find((x) => x.id === id);
    if (!p || !p.passwordEnc || !this.encryptionAvailable()) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(p.passwordEnc, "base64"));
    } catch {
      return null; // e.g. file copied from another machine / user
    }
  }
}

function uniqueName(base, list) {
  const names = new Set(list.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Keep only known fields of a stored profile (drops anything unexpected). */
function sanitizeStored(p) {
  const out = {
    id: String(p.id),
    name: typeof p.name === "string" ? p.name : "Unnamed",
    host: typeof p.host === "string" ? p.host : "127.0.0.1",
    port: Number.isInteger(p.port) ? p.port : 5142,
    group: typeof p.group === "string" ? p.group : "",
    token: typeof p.token === "string" ? p.token : "",
    color: typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : DEFAULT_COLOR,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : undefined,
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : undefined,
  };
  if (typeof p.passwordEnc === "string" && p.passwordEnc) out.passwordEnc = p.passwordEnc;
  return out;
}

module.exports = { ProfileStore, profileInput, DEFAULT_COLOR };

"use strict";

/**
 * Small JSON files in userData: settings.json and history.json.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const v = require("./validate");

const SETTINGS_DEFAULTS = Object.freeze({
  theme: "system",
  refreshMs: 2000,
  keyLimit: 500,
  confirmDestructive: true,
});

const settingsPatch = v.obj({
  theme: v.oneOf(["system", "light", "dark"], { optional: true }),
  refreshMs: v.int({ min: 500, max: 60000, optional: true }),
  keyLimit: v.int({ min: 10, max: 100000, optional: true }),
  confirmDestructive: v.bool({ optional: true }),
});

const HISTORY_KINDS = ["sql", "console"];
const HISTORY_MAX = 200;

class JsonFile {
  constructor(filePath, fs = nodeFs) {
    this.filePath = filePath;
    this.fs = fs;
  }

  read(fallback) {
    try {
      const data = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
      return data && typeof data === "object" ? data : fallback;
    } catch {
      return fallback;
    }
  }

  write(data) {
    this.fs.mkdirSync(nodePath.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(tmp, this.filePath);
  }
}

class SettingsStore {
  constructor(filePath, fs) {
    this.file = new JsonFile(filePath, fs);
    this.cache = null;
  }

  get() {
    if (!this.cache) {
      const stored = this.file.read({});
      let clean = {};
      try {
        // drop unknown or invalid stored values instead of failing
        for (const [k, val] of Object.entries(stored)) {
          try {
            Object.assign(clean, settingsPatch({ [k]: val }, "settings"));
          } catch {
            /* ignore invalid entry */
          }
        }
      } catch {
        clean = {};
      }
      this.cache = { ...SETTINGS_DEFAULTS, ...clean };
    }
    return { ...this.cache };
  }

  set(patch) {
    const clean = settingsPatch(patch, "settings");
    this.cache = { ...this.get(), ...clean };
    this.file.write(this.cache);
    return this.get();
  }
}

class HistoryStore {
  constructor(filePath, fs) {
    this.file = new JsonFile(filePath, fs);
    this.data = null;
  }

  _load() {
    if (!this.data) {
      const stored = this.file.read({});
      this.data = {};
      for (const kind of HISTORY_KINDS) {
        this.data[kind] = Array.isArray(stored[kind]) ? stored[kind].filter((x) => typeof x === "string").slice(0, HISTORY_MAX) : [];
      }
    }
    return this.data;
  }

  list(kind) {
    return [...this._load()[kind]];
  }

  /** Most recent first; an entry equal to an older one moves to the top. */
  add(kind, entry) {
    const data = this._load();
    const list = data[kind].filter((x) => x !== entry);
    list.unshift(entry);
    data[kind] = list.slice(0, HISTORY_MAX);
    this.file.write(data);
    return this.list(kind);
  }

  clear(kind) {
    const data = this._load();
    data[kind] = [];
    this.file.write(data);
    return [];
  }
}

module.exports = { SettingsStore, HistoryStore, SETTINGS_DEFAULTS, HISTORY_KINDS, HISTORY_MAX, settingsPatch };

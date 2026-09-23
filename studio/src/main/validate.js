"use strict";

/**
 * Tiny schema validators for IPC arguments.
 *
 * Every value that crosses the renderer -> main boundary goes through one of
 * these before it is used. A validator is a function `(value, path) => value`
 * that returns the (possibly normalised) value or throws a ValidationError.
 * Objects are strict: unknown properties are rejected, so a compromised
 * renderer cannot smuggle extra options into the Denis client.
 */

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.code = "EINVAL";
  }
}

function fail(path, message) {
  throw new ValidationError(`${path || "argument"} ${message}`);
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * @param {{min?: number, max?: number, pattern?: RegExp, trim?: boolean, allowEmpty?: boolean, optional?: boolean, noLineBreaks?: boolean, patternMessage?: string}} [o]
 */
function str(o = {}) {
  const { min = 0, max = 10000, pattern, trim = false, optional = false, noLineBreaks = false, patternMessage } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (typeof value !== "string") fail(path, `must be a string (got ${describe(value)})`);
    const v = trim ? value.trim() : value;
    if (v.length < min) fail(path, min === 1 ? "must not be empty" : `must be at least ${min} characters`);
    if (v.length > max) fail(path, `must be at most ${max} characters`);
    if (noLineBreaks && /[\r\n]/.test(v)) fail(path, "must not contain line breaks");
    if (pattern && !pattern.test(v)) fail(path, patternMessage || `has an invalid format`);
    return v;
  };
}

/** @param {{min?: number, max?: number, optional?: boolean}} [o] */
function int(o = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value)) fail(path, `must be an integer (got ${describe(value)})`);
    if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
    return value;
  };
}

/** @param {{min?: number, max?: number, optional?: boolean}} [o] */
function num(o = {}) {
  const { min = -Infinity, max = Infinity, optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, `must be a number (got ${describe(value)})`);
    if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
    return value;
  };
}

function bool(o = {}) {
  const { optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (typeof value !== "boolean") fail(path, `must be a boolean (got ${describe(value)})`);
    return value;
  };
}

function oneOf(values, o = {}) {
  const { optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (!values.includes(value)) fail(path, `must be one of ${values.map((v) => JSON.stringify(v)).join(", ")}`);
    return value;
  };
}

/** @param {(v:any, p:string)=>any} item @param {{min?: number, max?: number, optional?: boolean}} [o] */
function arr(item, o = {}) {
  const { min = 0, max = 10000, optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (!Array.isArray(value)) fail(path, `must be an array (got ${describe(value)})`);
    if (value.length < min) fail(path, `must have at least ${min} item(s)`);
    if (value.length > max) fail(path, `must have at most ${max} items`);
    return value.map((v, i) => item(v, `${path}[${i}]`));
  };
}

/** Strict object: unknown keys are rejected. */
function obj(shape, o = {}) {
  const { optional = false } = o;
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, `must be an object (got ${describe(value)})`);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(path, "must be a plain object");
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(shape, key)) fail(path, `has an unknown property "${key}"`);
    }
    const out = {};
    for (const [key, check] of Object.entries(shape)) {
      const v = check(value[key], path ? `${path}.${key}` : key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  };
}

function nullable(check) {
  return (value, path) => (value === null ? null : check(value, path));
}

/**
 * Any JSON-compatible value (for SQL parameters), bounded in depth and size.
 */
function jsonValue(o = {}) {
  const { maxDepth = 8, maxItems = 10000, optional = false } = o;
  const walk = (value, path, depth) => {
    if (depth > maxDepth) fail(path, "is nested too deeply");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(path, "must be a finite number");
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > maxItems) fail(path, `must have at most ${maxItems} items`);
      return value.map((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length > maxItems) fail(path, `must have at most ${maxItems} properties`);
      const out = {};
      for (const k of keys) out[k] = walk(value[k], `${path}.${k}`, depth + 1);
      return out;
    }
    fail(path, `is not JSON (got ${describe(value)})`);
    return undefined;
  };
  return (value, path) => {
    if (value === undefined && optional) return undefined;
    return walk(value, path, 0);
  };
}

// ---------------------------------------------------------------- domain types

/** Denis keys are one word: no whitespace at all. */
const KEY_RE = /^[^\s]+$/;
const key = (o = {}) => str({ min: 1, max: 1024, pattern: KEY_RE, patternMessage: "must be one word without spaces", ...o });
/** Glob pattern for KEYS: one word, too. */
const pattern = (o = {}) => str({ min: 1, max: 1024, pattern: KEY_RE, patternMessage: "must be one word without spaces", ...o });
/** Project tokens are 128 alphanumeric chars today; accept any sane word. */
const token = (o = {}) => str({ min: 1, max: 512, pattern: /^[A-Za-z0-9_\-.]+$/, patternMessage: "is not a valid project token", ...o });
const id = (o = {}) => str({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: "is not a valid id", ...o });
const host = (o = {}) => str({ min: 1, max: 253, trim: true, pattern: /^[A-Za-z0-9._:\-[\]%]+$/, patternMessage: "is not a valid host name or address", ...o });
const port = (o = {}) => int({ min: 1, max: 65535, ...o });
const group = (o = {}) => str({ min: 1, max: 128, trim: true, pattern: KEY_RE, patternMessage: "must be one word without spaces", ...o });
/** Passwords may contain spaces but never a line break (LIN is one line). */
const password = (o = {}) => str({ min: 0, max: 1024, noLineBreaks: true, ...o });
const color = (o = {}) => str({ pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: "must be a #rrggbb color", ...o });

/**
 * Run `check` against `value`, prefixing errors with `name`.
 * @template T
 * @param {(v:any, p:string)=>T} check
 */
function validate(check, value, name) {
  return check(value, name);
}

module.exports = {
  ValidationError,
  str,
  int,
  num,
  bool,
  oneOf,
  arr,
  obj,
  nullable,
  jsonValue,
  key,
  pattern,
  token,
  id,
  host,
  port,
  group,
  password,
  color,
  validate,
};

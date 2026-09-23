/**
 * Rules for Denis key/value text, shared by the key editor and the "New key"
 * dialog. Pure functions (unit-tested under Node).
 *
 * The protocol is line based: a value cannot contain a line break, and a
 * word starting with "-&" would be read as a flag (SET k a -&b -> flag).
 * Such values can be stored as a JSON string instead: JSON escapes line
 * breaks, and "-&" is written with the JSON unicode escape for "&".
 * Trailing spaces are kept by current servers (older builds trimmed them).
 */

export const KEY_RULE = "Keys are one word: no spaces, tabs or line breaks.";

/** @returns {string|null} error message, or null when the key is fine */
export function keyError(key) {
  if (typeof key !== "string" || key.length === 0) return "Key is required.";
  if (/\s/.test(key)) return KEY_RULE;
  if (key.startsWith("-&")) return "Keys cannot start with -&.";
  if (key.startsWith("__sql:")) return "Keys starting with __sql: are reserved for SQL tables.";
  if (key.length > 1024) return "Key is too long (max 1024 characters).";
  return null;
}

/**
 * Problems of a raw value on the wire. `problems` block saving; `warnings`
 * do not (current servers keep trailing spaces; Denis builds before the
 * protocol clarification trimmed them).
 * @returns {{ok: boolean, problems: string[], warnings: string[], fixable: boolean}}
 */
export function checkValue(value) {
  const problems = [];
  const warnings = [];
  if (typeof value !== "string" || value.length === 0) return { ok: false, problems: ["Value is required."], warnings, fixable: false };
  if (value.trim().length === 0) problems.push("Value cannot be only whitespace.");
  if (/[\r\n]/.test(value)) problems.push("Values cannot contain line breaks.");
  if (/(^|\s)-&/.test(value)) problems.push("No word of a value may start with -& (it would be read as a flag).");
  if (problems.length === 0 && /\s$/.test(value)) {
    warnings.push("Trailing spaces are kept by current Denis servers but dropped by older ones; store as a JSON string to be safe.");
  }
  return { ok: problems.length === 0, problems, warnings, fixable: problems.length > 0 };
}

/** JSON string literal that is safe on the wire (see escapeFlagMarkers). */
export function encodeAsJsonString(text) {
  return escapeFlagMarkers(JSON.stringify(String(text)));
}

/** "-&" can only occur inside JSON strings, where the unicode escape of "&" is equivalent. */
export function escapeFlagMarkers(json) {
  return json.replace(/-&/g, "-\\u0026");
}

/** Is this text a JSON object or array (worth pretty printing)? */
export function parseStructured(text) {
  if (typeof text !== "string") return { ok: false };
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}")) && !(t.startsWith("[") && t.endsWith("]"))) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

/** Value as displayed in the editor: pretty JSON for objects/arrays, raw text otherwise. */
export function toEditorText(value) {
  const parsed = parseStructured(value);
  if (parsed.ok) return { mode: "json", text: JSON.stringify(parsed.value, null, 2) };
  return { mode: "raw", text: value ?? "" };
}

/**
 * Turn editor text into the value sent to the server.
 * @param {string} text
 * @param {"json"|"raw"} mode   json = the editor shows JSON; it is compacted
 * @param {{asJsonString?: boolean}} [o]
 * @returns {{ok: true, value: string} | {ok: false, error: string, problems?: string[], canEncode?: boolean}}
 */
export function prepareValue(text, mode, o = {}) {
  if (o.asJsonString) {
    if (typeof text !== "string" || text.length === 0) return { ok: false, error: "Value is required." };
    return { ok: true, value: encodeAsJsonString(text) };
  }
  if (mode === "json") {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `Invalid JSON: ${err.message}. Switch to raw text to store it as-is.` };
    }
    return { ok: true, value: escapeFlagMarkers(JSON.stringify(parsed)) };
  }
  const check = checkValue(text);
  if (!check.ok) return { ok: false, error: check.problems.join(" "), problems: check.problems, canEncode: check.fixable };
  return { ok: true, value: text };
}

/** INCR works on integer values (optionally signed). */
export function isIntegerValue(value) {
  return typeof value === "string" && /^-?\d{1,18}$/.test(value.trim());
}

/** Parse a TTL input: empty -> undefined, else a positive integer of seconds. */
export function parseTtl(input) {
  const t = String(input ?? "").trim();
  if (t === "") return { ok: true, value: undefined };
  if (!/^\d+$/.test(t) || Number(t) <= 0) return { ok: false, error: "TTL must be a positive whole number of seconds." };
  if (Number(t) > 10 * 365 * 24 * 3600) return { ok: false, error: "TTL is too large (max 10 years)." };
  return { ok: true, value: Number(t) };
}

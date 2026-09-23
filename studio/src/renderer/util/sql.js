/**
 * SQL editor helpers (pure, unit-tested under Node).
 */

/**
 * Split a script into statements on semicolons outside of quotes and
 * comments. Empty statements are dropped; comments are kept in the text.
 * @param {string} script
 * @returns {string[]}
 */
export function splitStatements(script) {
  const out = [];
  let current = "";
  let i = 0;
  const s = String(script ?? "");
  let quote = null; // ' " `
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (quote) {
      current += c;
      if (c === quote) {
        if (next === quote) {
          // doubled quote = escaped quote
          current += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      const end = s.indexOf("\n", i);
      const stop = end < 0 ? s.length : end;
      current += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = s.indexOf("*/", i + 2);
      const stop = end < 0 ? s.length : end + 2;
      current += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      current += c;
      i++;
      continue;
    }
    if (c === ";") {
      if (hasCode(current)) out.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += c;
    i++;
  }
  if (hasCode(current)) out.push(current.trim());
  return out;
}

/** Does the text contain anything besides whitespace and comments? */
function hasCode(text) {
  const stripped = text.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped.trim().length > 0;
}

/** Remove comments (the server's parser may not accept them). Keeps string literals intact. */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  let quote = null;
  const s = String(sql ?? "");
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (quote) {
      out += c;
      if (c === quote) {
        if (next === quote) {
          out += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      const end = s.indexOf("\n", i);
      i = end < 0 ? s.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    out += c;
    i++;
  }
  return out.trim();
}

/** Prefix EXPLAIN unless the statement already is an EXPLAIN. */
export function explainOf(statement) {
  const t = String(statement ?? "").trim();
  return /^explain\b/i.test(t) ? t : `EXPLAIN ${t}`;
}

/**
 * Parse the parameters box: empty -> [], otherwise a JSON array.
 * @returns {{ok: true, value: any[]} | {ok: false, error: string}}
 */
export function parseParams(text) {
  const t = String(text ?? "").trim();
  if (t === "") return { ok: true, value: [] };
  let value;
  try {
    value = JSON.parse(t);
  } catch (err) {
    return { ok: false, error: `Parameters must be a JSON array: ${err.message}` };
  }
  if (!Array.isArray(value)) return { ok: false, error: "Parameters must be a JSON array, e.g. [1, \"Ada\"]." };
  return { ok: true, value };
}

/** Count `?` placeholders outside string literals. */
export function countPlaceholders(sql) {
  let n = 0;
  let quote = null;
  const s = stripComments(sql);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "?") n++;
  }
  return n;
}

/** Quote an identifier only when needed (for generated SELECT/DESCRIBE). */
export function ident(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Compare two cells for sorting: NULLs last, numbers numerically, booleans,
 * then strings with natural (numeric-aware) ordering.
 */
export function compareCells(a, b) {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const as = typeof a === "object" ? JSON.stringify(a) : String(a);
  const bs = typeof b === "object" ? JSON.stringify(b) : String(b);
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

/** Sorted copy of rows by column index; direction "asc" | "desc". Stable. */
export function sortRows(rows, column, direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const ax = x.row[column];
      const by = y.row[column];
      const xNull = ax === null || ax === undefined;
      const yNull = by === null || by === undefined;
      // NULLs always last, whatever the direction
      if (xNull || yNull) return xNull === yNull ? x.index - y.index : xNull ? 1 : -1;
      return compareCells(ax, by) * factor || x.index - y.index;
    })
    .map((x) => x.row);
}

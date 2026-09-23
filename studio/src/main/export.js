"use strict";

/**
 * Export of SQL result sets (CSV / JSON).
 *
 * CSV follows RFC 4180: fields containing a comma, quote, CR or LF (or
 * leading/trailing spaces) are quoted, quotes are doubled, records end with
 * CRLF. NULL becomes an empty field. By default, text cells that a
 * spreadsheet would evaluate as a formula (starting with = + - @, tab or CR)
 * are prefixed with a single quote (CSV injection guard); numbers are never
 * touched.
 */

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function csvField(value, { escapeFormulas = true, delimiter = "," } = {}) {
  let text = cellText(value);
  if (escapeFormulas && typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {string[]} columns
 * @param {any[][]} rows
 * @param {{escapeFormulas?: boolean, delimiter?: string, bom?: boolean, header?: boolean}} [o]
 */
function toCsv(columns, rows, o = {}) {
  const { bom = false, header = true } = o;
  const lines = [];
  if (header) lines.push(columns.map((c) => csvField(c, { ...o, escapeFormulas: false })).join(o.delimiter || ","));
  for (const row of rows) {
    const cells = [];
    for (let i = 0; i < columns.length; i++) cells.push(csvField(row[i], o));
    lines.push(cells.join(o.delimiter || ","));
  }
  return (bom ? "﻿" : "") + lines.join("\r\n") + (lines.length ? "\r\n" : "");
}

/** Unique object keys for columns (SELECT a.id, b.id gives "id" twice). */
function uniqueColumnNames(columns) {
  const seen = new Map();
  return columns.map((c) => {
    const name = String(c);
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

/** Rows as an array of objects, pretty printed. */
function toJson(columns, rows) {
  const names = uniqueColumnNames(columns);
  const objects = rows.map((row) => {
    const o = {};
    names.forEach((name, i) => {
      o[name] = row[i] === undefined ? null : row[i];
    });
    return o;
  });
  return JSON.stringify(objects, null, 2) + "\n";
}

/** Tab separated (for the clipboard: pastes into spreadsheets). */
function toTsv(columns, rows, { header = true } = {}) {
  const clean = (v) => cellText(v).replace(/[\t\r\n]+/g, " ");
  const lines = [];
  if (header) lines.push(columns.map(clean).join("\t"));
  for (const row of rows) lines.push(columns.map((_, i) => clean(row[i])).join("\t"));
  return lines.join("\n");
}

module.exports = { toCsv, toJson, toTsv, csvField, cellText, uniqueColumnNames };

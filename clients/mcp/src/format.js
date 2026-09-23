/** Text renderings of Denis replies, kept small so they fit a model's context. */

export const CHARACTER_LIMIT = 25_000;

/** Rows as a Markdown table. */
export function rowsToMarkdown(columns, rows) {
  if (rows.length === 0) return "_no rows_";
  const names = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? "NULL" : String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " "));
  const lines = [
    `| ${names.join(" | ")} |`,
    `| ${names.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${names.map((n) => cell(row[n])).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** Table descriptions (SHOW TABLES / DESCRIBE) as Markdown. */
export function tablesToMarkdown(tables) {
  if (tables.length === 0) return "_no tables_";
  return tables
    .map((t) => {
      const columns = t.columns.map((c) => `${c.name} ${c.type}`).join(", ");
      return `- **${t.name}** (${t.rows} row${t.rows === 1 ? "" : "s"}): ${columns}`;
    })
    .join("\n");
}

/** Cut a text response down to CHARACTER_LIMIT with a note on how to see more. */
export function truncate(text, hint = "narrow the query or lower the limit") {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n_[truncated at ${CHARACTER_LIMIT} characters; ${hint}]_`;
}

/** A tool result carrying both a text rendering and the structured payload. */
export function result(text, structured) {
  return {
    content: [{ type: "text", text: truncate(text) }],
    structuredContent: structured,
  };
}

/** An error result with a hint the model can act on. */
export function failure(message, hint) {
  return {
    isError: true,
    content: [{ type: "text", text: hint ? `Error: ${message}\nHint: ${hint}` : `Error: ${message}` }],
  };
}

/**
 * SQL: editor (Ctrl/Cmd+Enter runs), JSON parameters, results grid with
 * export, EXPLAIN, tables sidebar (SHOW TABLES / DESCRIBE), history.
 *
 * Statements are sent with QUERY {"sql", "params"} (one statement per
 * request; a script with several statements separated by ";" is run one
 * after the other and stops at the first error).
 */
import { h, replace, busy, uid } from "../util/dom.js";
import { pageHeader, button, iconButton } from "../components/common.js";
import { toast, toastError } from "../components/toast.js";
import { DataGrid } from "../components/datagrid.js";
import { confirmDialog } from "../components/dialog.js";
import { splitStatements, stripComments, explainOf, parseParams, countPlaceholders, ident } from "../util/sql.js";
import { formatMs, formatNumber } from "../util/format.js";

const DESTRUCTIVE = /^\s*(drop|truncate|delete|alter)\b/i;

export default {
  id: "sql",
  title: "SQL",
  icon: "table",
  needs: "project",
  mount(root, ctx) {
    const { api } = ctx;
    let history = [];
    const editorId = uid("sql");
    const editor = h("textarea", {
      id: editorId,
      class: "input mono sql-editor",
      rows: "8",
      spellcheck: "false",
      autocomplete: "off",
      placeholder: "SELECT * FROM users WHERE id = ?",
      "aria-describedby": `${editorId}-hint`,
    });
    const paramsId = uid("params");
    const params = h("input", { id: paramsId, class: "input mono", spellcheck: "false", autocomplete: "off", placeholder: '[1, "Ada"]  (optional JSON array for ? placeholders)' });
    const runBtn = button("Run", () => run(false), { kind: "primary", iconName: "play", title: "Ctrl+Enter" });
    const explainBtn = button("Explain", () => run(true), { iconName: "explain", title: "Ctrl+Shift+E" });
    const results = h("div", { class: "sql-results", "aria-live": "polite" });
    const tablesList = h("ul", { class: "tables-list", "aria-label": "Tables" });
    const historyList = h("ol", { class: "history-list", "aria-label": "Query history" });

    root.append(
      pageHeader("SQL", "Run statements against the current project. Parameters are bound with QUERY (safe from injection)."),
      h(
        "div",
        { class: "sql-layout" },
        h(
          "aside",
          { class: "sql-side", "aria-label": "Tables and history" },
          h("div", { class: "side-head" }, h("h2", {}, "Tables"), iconButton("refresh", "Reload tables", () => loadTables())),
          tablesList,
          h("div", { class: "side-head" }, h("h2", {}, "History"), iconButton("trash", "Clear history", () => clearHistory())),
          historyList,
        ),
        h(
          "div",
          { class: "sql-main" },
          h("label", { for: editorId, class: "sr-only" }, "SQL statement"),
          editor,
          h("div", { class: "hint", id: `${editorId}-hint` }, "Ctrl/Cmd+Enter runs, Ctrl/Cmd+Shift+E explains. Separate several statements with ;"),
          h("div", { class: "field" }, h("label", { for: paramsId }, "Parameters"), params),
          h("div", { class: "row gap" }, runBtn, explainBtn, button("Clear", () => {
            editor.value = "";
            params.value = "";
            editor.focus();
          })),
          results,
        ),
      ),
    );

    editor.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        run(false);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        run(true);
      } else if (e.key === "Tab" && !e.shiftKey && !mod) {
        // insert two spaces instead of leaving the editor (Esc then Tab leaves)
        if (editor.dataset.escaped === "1") return;
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t } = editor;
        editor.setRangeText("  ", s, t, "end");
      } else if (e.key === "Escape") {
        editor.dataset.escaped = "1";
      }
    });
    editor.addEventListener("blur", () => delete editor.dataset.escaped);
    params.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run(false);
      }
    });

    // ------------------------------------------------------------ run
    async function run(explain) {
      const script = editor.value;
      const statements = splitStatements(script).map(stripComments).filter(Boolean);
      if (statements.length === 0) {
        toast("Type a SQL statement first.", { kind: "warning" });
        editor.focus();
        return;
      }
      const p = parseParams(params.value);
      if (!p.ok) {
        toast(p.error, { kind: "warning" });
        params.focus();
        return;
      }
      if (p.value.length && statements.length > 1) {
        toast("Parameters can only be used with a single statement.", { kind: "warning" });
        return;
      }
      if (p.value.length) {
        const n = countPlaceholders(statements[0]);
        if (n !== p.value.length) {
          toast(`The statement has ${n} placeholder(s) but ${p.value.length} parameter(s) were given.`, { kind: "warning" });
          return;
        }
      }
      const list = explain ? statements.map(explainOf) : statements;
      if (!explain && list.some((s) => DESTRUCTIVE.test(s))) {
        const ok = await confirmDialog({ title: "Run destructive statement?", message: "The script contains DROP, TRUNCATE, DELETE or ALTER. Run it?", confirmLabel: "Run", danger: true });
        if (!ok) return;
      }
      await addHistory(script.trim());
      await busy([runBtn, explainBtn], async () => {
        replace(results);
        let total = 0;
        for (let i = 0; i < list.length; i++) {
          const sql = list[i];
          try {
            const r = await api.db.query(sql, p.value);
            total += r.ms;
            results.append(renderResult(sql, r.result, r.ms, list.length > 1 ? i + 1 : null));
          } catch (err) {
            results.append(renderError(sql, err, list.length > 1 ? i + 1 : null));
            toastError(err, "SQL error");
            break;
          }
        }
        if (list.length > 1) results.prepend(h("p", { class: "muted small" }, `${list.length} statements · ${formatMs(total)} total`));
        if (list.some((s) => /^\s*(create|drop|alter)\b/i.test(s))) loadTables();
      });
    }

    function headline(sql, index) {
      return h("div", { class: "result-sql mono", title: sql }, index ? `#${index} ` : "", sql.length > 200 ? `${sql.slice(0, 200)}…` : sql);
    }

    function renderResult(sql, r, ms, index) {
      const block = h("section", { class: "result-block", "aria-label": `Result${index ? ` ${index}` : ""}` });
      block.append(headline(sql, index));
      const meta = [];
      if (r.columns) meta.push(`${formatNumber(r.count ?? (r.rows ? r.rows.length : 0))} row${(r.count ?? 0) === 1 ? "" : "s"}`);
      if (r.message) meta.push(r.message);
      if (r.affected !== undefined && !r.columns) meta.push(`${formatNumber(r.affected)} affected`);
      if (r.lastRowId !== undefined) meta.push(`last row id ${r.lastRowId}`);
      meta.push(formatMs(ms));
      const exportBtns = r.columns
        ? [
            button("CSV", () => exportResult(r, "csv"), { small: true, iconName: "download", title: "Export as CSV" }),
            button("JSON", () => exportResult(r, "json"), { small: true, iconName: "download", title: "Export as JSON" }),
          ]
        : [];
      block.append(h("div", { class: "result-meta" }, h("span", { class: "result-ok" }, "OK"), h("span", {}, meta.join(" · ")), h("span", { class: "spacer" }), ...exportBtns));
      if (r.columns) {
        const grid = new DataGrid({ columns: r.columns, rows: r.rows || [], caption: `Result of ${sql}` });
        block.append(grid.el);
      }
      return block;
    }

    function renderError(sql, err, index) {
      return h(
        "section",
        { class: "result-block result-error", role: "alert" },
        headline(sql, index),
        h("div", { class: "result-meta" }, h("span", { class: "code-badge" }, err.code || "ERROR"), h("span", {}, err.message)),
      );
    }

    async function exportResult(r, format) {
      try {
        const out = await api.result.exportFile({ columns: r.columns, rows: r.rows || [], format, name: "denis-result" });
        if (!out.canceled) toast(`Saved ${formatNumber(out.rows)} rows to ${out.path}`, { kind: "success" });
      } catch (err) {
        toastError(err, "Export failed");
      }
    }

    // ------------------------------------------------------------ tables
    async function loadTables() {
      try {
        const { result } = await api.db.query("SHOW TABLES", []);
        const idx = (name) => (result.columns || []).indexOf(name);
        const iTable = idx("table") >= 0 ? idx("table") : 0;
        const iRows = idx("rows");
        const tables = (result.rows || []).map((row) => ({ name: String(row[iTable]), rows: iRows >= 0 ? row[iRows] : null }));
        if (tables.length === 0) {
          replace(tablesList, h("li", { class: "muted small" }, "No tables. CREATE TABLE … to add one."));
          return;
        }
        replace(
          tablesList,
          tables.map((t) =>
            h(
              "li",
              {},
              h(
                "button",
                { type: "button", class: "table-btn", onclick: () => describe(t.name), title: `DESCRIBE ${t.name}` },
                h("span", { class: "mono" }, t.name),
                t.rows !== null ? h("span", { class: "muted small" }, formatNumber(t.rows)) : null,
              ),
              iconButton("play", `SELECT * FROM ${t.name} LIMIT 100`, () => {
                editor.value = `SELECT * FROM ${ident(t.name)} LIMIT 100`;
                params.value = "";
                run(false);
              }),
            ),
          ),
        );
      } catch (err) {
        replace(tablesList, h("li", { class: "muted small" }, `Could not list tables (${err.code || "error"}).`));
      }
    }

    async function describe(name) {
      const sql = `DESCRIBE ${ident(name)}`;
      try {
        const r = await api.db.query(sql, []);
        replace(results, renderResult(sql, r.result, r.ms, null));
      } catch (err) {
        replace(results, renderError(sql, err, null));
      }
    }

    // ------------------------------------------------------------ history
    async function loadHistory() {
      try {
        history = await api.history.list("sql");
      } catch {
        history = [];
      }
      renderHistory();
    }

    function renderHistory() {
      if (history.length === 0) {
        replace(historyList, h("li", { class: "muted small" }, "Statements you run appear here."));
        return;
      }
      replace(
        historyList,
        history.slice(0, 50).map((entry) =>
          h(
            "li",
            {},
            h(
              "button",
              {
                type: "button",
                class: "history-btn mono",
                title: entry,
                onclick: () => {
                  editor.value = entry;
                  editor.focus();
                },
              },
              entry.length > 90 ? `${entry.slice(0, 90)}…` : entry,
            ),
          ),
        ),
      );
    }

    async function addHistory(entry) {
      if (!entry) return;
      try {
        history = await api.history.add("sql", entry);
        renderHistory();
      } catch {
        /* history is best effort */
      }
    }

    async function clearHistory() {
      const ok = await confirmDialog({ title: "Clear SQL history?", message: "Remove all saved statements from the history?", confirmLabel: "Clear" });
      if (!ok) return;
      history = await api.history.clear("sql");
      renderHistory();
    }

    loadTables();
    loadHistory();
    editor.focus();

    return { refresh: loadTables };
  },
};

/**
 * Result grid: sortable columns (client side), NULL shown distinctly, cell
 * focus with arrow keys, Ctrl/Cmd+C copies the focused cell, Ctrl/Cmd+Shift+C
 * the focused row (tab separated). Large results render in pages
 * ("Show more") to keep the DOM small.
 */
import { h, clear } from "../util/dom.js";
import { sortRows } from "../util/sql.js";
import { api } from "../api.js";
import { toast, toastError } from "./toast.js";
import { icon } from "./icons.js";

const PAGE = 500;

function cellContent(value) {
  if (value === null || value === undefined) return h("span", { class: "null" }, "NULL");
  if (typeof value === "boolean") return h("span", { class: "bool" }, String(value));
  if (typeof value === "number") return h("span", { class: "num" }, String(value));
  if (typeof value === "object") return h("span", { class: "json" }, JSON.stringify(value));
  return String(value);
}

export function cellToText(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export class DataGrid {
  /**
   * @param {{columns: string[], rows: any[][], caption?: string}} o
   */
  constructor(o) {
    this.columns = o.columns;
    this.original = o.rows;
    this.rows = o.rows;
    this.sort = null; // {index, dir}
    this.shown = Math.min(PAGE, this.rows.length);
    this.focus = { r: 0, c: 0 };
    this.thead = h("thead");
    this.tbody = h("tbody");
    this.table = h(
      "table",
      { class: "grid", role: "grid", "aria-rowcount": String(this.rows.length + 1), "aria-colcount": String(this.columns.length) },
      o.caption ? h("caption", { class: "sr-only" }, o.caption) : null,
      this.thead,
      this.tbody,
    );
    this.more = h("button", { type: "button", class: "btn btn-small", onclick: () => this.showMore() });
    this.moreWrap = h("div", { class: "grid-more" }, this.more);
    this.status = h("span", { class: "grid-status muted" });
    this.toolbar = h(
      "div",
      { class: "grid-toolbar" },
      h("button", { type: "button", class: "btn btn-small", onclick: () => this.copyCell(), title: "Copy the focused cell (Ctrl+C)" }, icon("copy", { size: 14 }), "Copy cell"),
      h("button", { type: "button", class: "btn btn-small", onclick: () => this.copyRow(), title: "Copy the focused row (Ctrl+Shift+C)" }, icon("copy", { size: 14 }), "Copy row"),
      h("button", { type: "button", class: "btn btn-small", onclick: () => this.copyAll(), title: "Copy all rows as tab separated text" }, icon("copy", { size: 14 }), "Copy all"),
      this.status,
    );
    this.scroller = h("div", { class: "grid-scroll" }, this.table);
    this.el = h("div", { class: "grid-wrap" }, this.toolbar, this.scroller, this.moreWrap);
    this.table.addEventListener("keydown", (e) => this.onKey(e));
    this.table.addEventListener("focusin", (e) => {
      const td = e.target.closest("td");
      if (td && td.dataset.r !== undefined) this.focus = { r: Number(td.dataset.r), c: Number(td.dataset.c) };
    });
    this.renderHead();
    this.renderBody();
  }

  renderHead() {
    clear(this.thead);
    const tr = h("tr", { "aria-rowindex": "1" });
    this.columns.forEach((name, i) => {
      const active = this.sort && this.sort.index === i;
      const dir = active ? this.sort.dir : null;
      const th = h(
        "th",
        { scope: "col", "aria-sort": dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none" },
        h(
          "button",
          { type: "button", class: "sort-btn", onclick: () => this.toggleSort(i), title: `Sort by ${name}` },
          h("span", {}, name),
          h("span", { class: "sort-mark", "aria-hidden": "true" }, dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""),
        ),
      );
      tr.append(th);
    });
    this.thead.append(tr);
  }

  renderBody() {
    clear(this.tbody);
    const frag = document.createDocumentFragment();
    const count = Math.min(this.shown, this.rows.length);
    for (let r = 0; r < count; r++) frag.append(this.rowEl(r));
    this.tbody.append(frag);
    if (this.rows.length === 0) {
      this.tbody.append(h("tr", {}, h("td", { colspan: String(this.columns.length), class: "muted empty-cell" }, "No rows")));
    }
    this.updateMore();
    this.setFocusable();
  }

  rowEl(r) {
    const row = this.rows[r];
    const tr = h("tr", { "aria-rowindex": String(r + 2) });
    for (let c = 0; c < this.columns.length; c++) {
      tr.append(h("td", { tabindex: "-1", dataset: { r: String(r), c: String(c) }, role: "gridcell" }, cellContent(row[c])));
    }
    return tr;
  }

  updateMore() {
    const rest = this.rows.length - this.shown;
    this.moreWrap.hidden = rest <= 0;
    this.more.textContent = `Show ${Math.min(PAGE, rest)} more (${rest} not shown)`;
    this.status.textContent = `${this.rows.length} row${this.rows.length === 1 ? "" : "s"}${this.sort ? ` · sorted by ${this.columns[this.sort.index]} ${this.sort.dir}` : ""}`;
  }

  showMore() {
    const start = this.shown;
    this.shown = Math.min(this.rows.length, this.shown + PAGE);
    const frag = document.createDocumentFragment();
    for (let r = start; r < this.shown; r++) frag.append(this.rowEl(r));
    this.tbody.append(frag);
    this.updateMore();
  }

  toggleSort(index) {
    if (!this.sort || this.sort.index !== index) this.sort = { index, dir: "asc" };
    else if (this.sort.dir === "asc") this.sort = { index, dir: "desc" };
    else this.sort = null;
    this.rows = this.sort ? sortRows(this.original, this.sort.index, this.sort.dir) : this.original;
    this.renderHead();
    this.renderBody();
  }

  cell(r, c) {
    return this.tbody.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }

  setFocusable() {
    for (const td of this.tbody.querySelectorAll('td[tabindex="0"]')) td.tabIndex = -1;
    if (this.focus.r >= this.shown) this.focus = { r: 0, c: 0 };
    const td = this.cell(this.focus.r, this.focus.c);
    if (td) td.tabIndex = 0;
  }

  moveFocus(r, c) {
    const maxR = Math.min(this.shown, this.rows.length) - 1;
    const nr = Math.max(0, Math.min(maxR, r));
    const nc = Math.max(0, Math.min(this.columns.length - 1, c));
    const prev = this.cell(this.focus.r, this.focus.c);
    if (prev) prev.tabIndex = -1;
    this.focus = { r: nr, c: nc };
    const td = this.cell(nr, nc);
    if (td) {
      td.tabIndex = 0;
      td.focus();
    }
  }

  onKey(e) {
    const td = e.target.closest("td");
    if (!td || td.dataset.r === undefined) return;
    const { r, c } = this.focus;
    const mod = e.ctrlKey || e.metaKey;
    const moves = { ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], Home: [r, 0], End: [r, this.columns.length - 1], PageUp: [r - 20, c], PageDown: [r + 20, c] };
    if (moves[e.key]) {
      e.preventDefault();
      this.moveFocus(...moves[e.key]);
    } else if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (e.shiftKey) this.copyRow();
      else this.copyCell();
    }
  }

  async copyCell() {
    const row = this.rows[this.focus.r];
    if (!row) return;
    try {
      await api.app.copy(cellToText(row[this.focus.c]));
      toast(`Copied ${this.columns[this.focus.c]} of row ${this.focus.r + 1}`, { kind: "success", timeout: 1500 });
    } catch (err) {
      toastError(err, "Copy failed");
    }
  }

  async copyRow() {
    const row = this.rows[this.focus.r];
    if (!row) return;
    try {
      await api.app.copyRows({ columns: this.columns, rows: [row], header: false });
      toast(`Copied row ${this.focus.r + 1}`, { kind: "success", timeout: 1500 });
    } catch (err) {
      toastError(err, "Copy failed");
    }
  }

  async copyAll() {
    try {
      await api.app.copyRows({ columns: this.columns, rows: this.rows.slice(0, 100000), header: true });
      toast(`Copied ${Math.min(this.rows.length, 100000)} rows`, { kind: "success", timeout: 1500 });
    } catch (err) {
      toastError(err, "Copy failed");
    }
  }
}

/**
 * Backup & Restore:
 *  (a) server backups (admin groups): SAVE snapshot, BACKUP now, BACKUPS list
 *  (b) logical export of the current project (DUMP -> .denis.json) and import
 *      of such a file with preview, "replace existing tables" and progress.
 */
import { h, replace, busy, uid } from "../util/dom.js";
import { pageHeader, card, badge, button, statList, emptyState } from "../components/common.js";
import { toast, toastError, toastSuccess } from "../components/toast.js";
import { confirmDialog } from "../components/dialog.js";
import { formatBytes, formatDate, formatNumber, relativeTime, shortToken, formatMs, plural } from "../util/format.js";

export default {
  id: "backup",
  title: "Backup & Restore",
  icon: "archive",
  needs: "connection",
  mount(root, ctx) {
    const { api, store } = ctx;
    const serverBox = h("div");
    const exportBox = h("div");
    const importBox = h("div");
    let pending = null; // result of dump.open
    let unsubscribeProgress = null;

    root.append(pageHeader("Backup & Restore", "Server backups (admin) and logical export/import of the current project."), h("div", { class: "backup-grid" }, serverBox, h("div", { class: "stack" }, exportBox, importBox)));

    // ------------------------------------------------------------ server backups
    async function renderServer() {
      const st = store.get().status;
      if (!st.admin) {
        replace(
          serverBox,
          card(
            "Server backups",
            h("p", {}, "SAVE, BACKUP and BACKUPS need an admin group. You are logged in as ", h("strong", {}, st.group || "?"), " ", badge("regular", "muted"), "."),
            h("p", { class: "muted small" }, "Use the logical export on the right to back up the current project."),
          ),
        );
        return;
      }
      const list = h("div", {}, h("p", { class: "muted" }, "Loading…"));
      const saveBtn = button("SAVE snapshot", () => save(saveBtn), { iconName: "save", title: "Write a snapshot and truncate the log (checkpoint)" });
      const backupBtn = button("BACKUP now", () => backup(backupBtn), { kind: "primary", iconName: "archive", title: "Create a zip of the data directory on the server" });
      replace(
        serverBox,
        card(
          h("span", {}, "Server backups ", badge("admin", "admin")),
          h("p", { class: "muted small" }, "Backups are written by the server into its own backup directory."),
          h("div", { class: "row gap" }, backupBtn, saveBtn, button("Refresh", () => loadBackups(list), { small: true, iconName: "refresh" })),
          list,
        ),
      );
      loadBackups(list);
    }

    async function loadBackups(list) {
      try {
        const r = await api.db.backups();
        if (r.backups.length === 0) {
          replace(list, h("p", { class: "muted" }, "No backups yet."), r.directory ? h("p", { class: "muted small" }, "Directory: ", h("code", {}, r.directory)) : null);
          return;
        }
        const rows = [...r.backups]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map((b) =>
            h(
              "tr",
              {},
              h("td", { class: "mono" }, b.name),
              h("td", { class: "num" }, formatBytes(b.bytes)),
              h("td", { title: formatDate(b.createdAt) }, relativeTime(b.createdAt)),
              h("td", {}, b.path ? button("Copy path", () => api.app.copy(b.path).then(() => toast("Path copied.", { kind: "success", timeout: 1500 }), toastError), { small: true, iconName: "copy" }) : null),
            ),
          );
        replace(
          list,
          h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              { class: "table table-compact" },
              h("caption", { class: "sr-only" }, "Server backups"),
              h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Name"), h("th", { scope: "col", class: "num" }, "Size"), h("th", { scope: "col" }, "Created"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
              h("tbody", {}, rows),
            ),
          ),
          r.directory ? h("p", { class: "muted small" }, "Directory on the server: ", h("code", {}, r.directory)) : null,
        );
      } catch (err) {
        replace(list, h("p", { class: "text-error" }, `${err.code}: ${err.message}`));
      }
    }

    async function save(btn) {
      await busy(btn, async () => {
        try {
          const r = await api.db.save();
          toastSuccess(`Snapshot written: ${formatBytes(r.bytes)}, ${formatNumber(r.records)} records, ${formatNumber(r.millis)} ms.`, "SAVE");
        } catch (err) {
          toastError(err, "SAVE failed");
        }
      });
    }

    async function backup(btn) {
      await busy(btn, async () => {
        try {
          const r = await api.db.backup();
          toastSuccess(`${r.name} (${formatBytes(r.bytes)})`, "Backup created");
          renderServer();
        } catch (err) {
          toastError(err, "BACKUP failed");
        }
      });
    }

    // ------------------------------------------------------------ export
    function renderExport() {
      const st = store.get().status;
      const exportBtn = button("Export project…", () => doExport(exportBtn), { kind: "primary", iconName: "download" });
      const result = h("div", { role: "status" });
      replace(
        exportBox,
        card(
          "Export project",
          st.project
            ? [
                h("p", {}, "Saves every key (cache, durable, TTLs) and table of project ", h("span", { class: "mono" }, shortToken(st.project)), " to a ", h("code", {}, ".denis.json"), " file."),
                h("p", { class: "muted small" }, "TTLs are stored as the time left at export; they restart when imported. The file does not contain the full project token."),
                h("div", { class: "row gap" }, exportBtn),
                result,
              ]
            : emptyState("No project selected", "Choose a project to export.", button("Go to Projects", () => ctx.navigate("projects"), { iconName: "folder" })),
        ),
      );
      exportBox.result = result;
    }

    async function doExport(btn) {
      await busy(btn, async () => {
        const result = exportBox.result;
        replace(result, h("p", { class: "muted" }, "Reading the project (DUMP)…"));
        try {
          const r = await api.dump.exportProject();
          if (r.canceled) {
            replace(result);
            return;
          }
          replace(
            result,
            h("div", { class: "callout callout-success" }, h("strong", {}, "Exported. "), `${plural(r.summary.keys, "key")}, ${plural(r.summary.tables, "table")}, ${plural(r.summary.rows, "row")} · ${formatBytes(r.bytes)}`, h("div", { class: "mono small wrap" }, r.path)),
          );
          toastSuccess(`Saved to ${r.path}`, "Export complete");
        } catch (err) {
          replace(result);
          toastError(err, "Export failed");
        }
      });
    }

    // ------------------------------------------------------------ import
    function renderImport() {
      const st = store.get().status;
      const openBtn = button("Choose file…", () => chooseFile(openBtn), { iconName: "upload" });
      replace(
        importBox,
        card(
          "Import into current project",
          st.project
            ? [
                h("p", {}, "Merges a ", h("code", {}, ".denis.json"), " export (or a raw DUMP) into project ", h("span", { class: "mono" }, shortToken(st.project)), ". Keys with the same name are overwritten."),
                h("div", { class: "row gap" }, openBtn),
                h("div", { class: "import-preview" }),
              ]
            : emptyState("No project selected", "Choose a project to import into.", button("Go to Projects", () => ctx.navigate("projects"), { iconName: "folder" })),
        ),
      );
      if (pending) renderPreview();
    }

    async function chooseFile(btn) {
      await busy(btn, async () => {
        try {
          if (pending) await api.dump.discard(pending.handle).catch(() => {});
          const r = await api.dump.open();
          if (r.canceled) return;
          pending = r;
          renderPreview();
        } catch (err) {
          pending = null;
          toastError(err, "Cannot read file");
        }
      });
    }

    async function renderPreview() {
      const box = importBox.querySelector(".import-preview");
      if (!box || !pending) return;
      const s = pending.summary;
      let existing = [];
      try {
        const { result } = await api.db.query("SHOW TABLES", []);
        const i = (result.columns || []).indexOf("table");
        existing = (result.rows || []).map((row) => String(row[i >= 0 ? i : 0]).toLowerCase());
      } catch {
        /* preview still works without it */
      }
      const conflicts = s.tableList.filter((t) => existing.includes(t.name.toLowerCase())).map((t) => t.name);
      const replaceId = uid("replace");
      const replaceBox = h("input", { type: "checkbox", id: replaceId });
      const warning = h("div", { role: "status" });
      const updateWarning = () => {
        replace(
          warning,
          conflicts.length && !replaceBox.checked
            ? h("div", { class: "callout callout-warning" }, `These tables already exist: ${conflicts.join(", ")}. Without "replace", the import stops at the first of them (keys before it are already imported).`)
            : conflicts.length
              ? h("div", { class: "callout callout-info" }, `Existing tables will be dropped and re-created: ${conflicts.join(", ")}.`)
              : null,
        );
      };
      replaceBox.addEventListener("change", updateWarning);
      const progress = h("progress", { max: "1", value: "0", class: "progress", "aria-label": "Import progress" });
      const progressText = h("span", { class: "muted small" });
      const progressRow = h("div", { class: "progress-row", hidden: true }, progress, progressText);
      const result = h("div", { role: "status" });
      const importBtn = button("Import", () => doImport(importBtn, replaceBox.checked, { progress, progressText, progressRow, result }), { kind: "primary", iconName: "upload" });
      const cancelBtn = button("Cancel", async () => {
        await api.dump.discard(pending.handle).catch(() => {});
        pending = null;
        replace(box);
      });
      const src = (pending.meta && pending.meta.source) || {};
      replace(
        box,
        h(
          "div",
          { class: "preview" },
          h("h3", {}, pending.fileName, " ", h("span", { class: "muted small" }, formatBytes(pending.bytes))),
          statList([
            ["Keys", `${formatNumber(s.keys)} (${formatNumber(s.cacheKeys)} cache, ${formatNumber(s.persistentKeys)} durable, ${formatNumber(s.ttlKeys)} with TTL)`],
            ["Tables", formatNumber(s.tables)],
            ["Rows", formatNumber(s.rows)],
            ...(pending.meta
              ? [
                  ["Exported", pending.meta.exportedAt ? formatDate(pending.meta.exportedAt) : "–"],
                  ["Source", `${src.group ?? "?"}@${src.host ?? "?"}:${src.port ?? "?"} · project ${src.project ?? "?"} · Denis ${src.serverVersion ?? "?"}`],
                ]
              : [["Format", "raw DUMP object"]]),
          ]),
          s.tableList.length
            ? h(
                "div",
                { class: "table-wrap" },
                h(
                  "table",
                  { class: "table table-compact" },
                  h("caption", { class: "sr-only" }, "Tables in the file"),
                  h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Table"), h("th", { scope: "col", class: "num" }, "Columns"), h("th", { scope: "col", class: "num" }, "Rows"), h("th", { scope: "col", class: "num" }, "Indexes"), h("th", { scope: "col" }, ""))),
                  h(
                    "tbody",
                    {},
                    s.tableList.map((t) =>
                      h("tr", {}, h("td", { class: "mono" }, t.name), h("td", { class: "num" }, formatNumber(t.columns)), h("td", { class: "num" }, formatNumber(t.rows)), h("td", { class: "num" }, formatNumber(t.indexes)), h("td", {}, conflicts.includes(t.name) ? badge("exists", "warn") : badge("new", "ok"))),
                    ),
                  ),
                ),
              )
            : null,
          h("div", { class: "checkbox-field" }, replaceBox, h("label", { for: replaceId }, "Replace existing tables with the same name")),
          warning,
          h("div", { class: "row gap" }, importBtn, cancelBtn),
          progressRow,
          result,
        ),
      );
      updateWarning();
    }

    async function doImport(btn, replaceTables, ui) {
      if (!pending) return;
      const st = store.get().status;
      const ok = await confirmDialog({
        title: "Import data?",
        message: `Import ${formatNumber(pending.summary.keys)} keys and ${formatNumber(pending.summary.tables)} tables into project ${shortToken(st.project)}? Existing keys with the same names are overwritten${replaceTables ? " and existing tables with the same names are replaced" : ""}.`,
        confirmLabel: "Import",
        danger: replaceTables,
      });
      if (!ok) return;
      const handle = pending.handle;
      ui.progressRow.hidden = false;
      ui.progress.removeAttribute("value"); // indeterminate until the first progress event
      ui.progressText.textContent = "Importing…";
      if (unsubscribeProgress) unsubscribeProgress();
      unsubscribeProgress = api.dump.onProgress((p) => {
        if (!p || p.handle !== handle) return;
        if (p.total) {
          ui.progress.max = p.total;
          ui.progress.value = p.done;
          ui.progressText.textContent = `${p.done} / ${p.total} chunks`;
        }
      });
      await busy(btn, async () => {
        try {
          const r = await api.dump.importFile(handle, { replace: replaceTables });
          ui.progress.max = 1;
          ui.progress.value = 1;
          ui.progressText.textContent = `Done in ${formatMs(r.ms)}`;
          const i = r.imported || {};
          replace(ui.result, h("div", { class: "callout callout-success" }, h("strong", {}, "Imported. "), `${plural(i.persistent || 0, "durable key")}, ${plural(i.cache || 0, "cache key")}, ${plural(i.tables || 0, "table")}, ${plural(i.rows || 0, "row")}.`));
          toastSuccess(`${r.fileName}: ${formatNumber(i.rows)} rows, ${formatNumber((i.persistent || 0) + (i.cache || 0))} key values`, "Import complete");
          pending = null;
        } catch (err) {
          ui.progress.max = 1;
          ui.progress.value = 0;
          ui.progressText.textContent = "Failed";
          replace(ui.result, h("div", { class: "callout callout-error" }, h("span", { class: "code-badge" }, err.code || "ERROR"), " ", err.message, h("p", { class: "small" }, "Parts of the file imported before the error stay in the project.")));
          toastError(err, "Import failed");
        } finally {
          if (unsubscribeProgress) unsubscribeProgress();
          unsubscribeProgress = null;
        }
      });
    }

    function renderAll() {
      renderServer();
      renderExport();
      renderImport();
    }
    renderAll();

    return {
      refresh: renderAll,
      onStatus(status, prev) {
        if (status.project !== prev.project || status.admin !== prev.admin) renderAll();
      },
      unmount() {
        if (unsubscribeProgress) unsubscribeProgress();
        if (pending) api.dump.discard(pending.handle).catch(() => {});
      },
    };
  },
};

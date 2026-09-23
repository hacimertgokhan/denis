/**
 * Projects: PROJECTS list, create, delete (typed confirmation), switch (AUTH).
 */
import { h, replace, busy } from "../util/dom.js";
import { pageHeader, badge, button, iconButton, emptyState } from "../components/common.js";
import { toast, toastError, toastSuccess } from "../components/toast.js";
import { modal, typedConfirm } from "../components/dialog.js";
import { shortToken, formatNumber } from "../util/format.js";

export default {
  id: "projects",
  title: "Projects",
  icon: "folder",
  needs: "connection",
  mount(root, ctx) {
    const { api, store } = ctx;
    const body = h("div");
    const createBtn = button("New project", () => create(createBtn), { kind: "primary", iconName: "plus" });
    root.append(
      pageHeader("Projects", "Each project has its own keys and SQL tables. Tokens are secrets: share them carefully.", button("Refresh", () => load(), { iconName: "refresh", small: true }), createBtn),
      body,
    );

    async function load() {
      try {
        const projects = await api.db.projects();
        render(projects);
      } catch (err) {
        toastError(err, "PROJECTS failed");
      }
    }

    async function copy(token) {
      try {
        await api.app.copy(token);
        toast("Token copied to the clipboard.", { kind: "success", timeout: 2000 });
      } catch (err) {
        toastError(err);
      }
    }

    function render(projects) {
      const st = store.get().status;
      if (projects.length === 0) {
        replace(body, emptyState("No projects yet", "Create a project to store keys and tables.", button("New project", () => create(createBtn), { kind: "primary", iconName: "plus" })));
        return;
      }
      const rows = projects.map((p) => {
        const current = p.current || p.token === st.project;
        return h(
          "tr",
          { class: current ? "row-current" : null },
          h(
            "td",
            {},
            h("span", { class: "mono", title: p.token }, shortToken(p.token)),
            " ",
            iconButton("copy", "Copy full token", () => copy(p.token)),
            current ? badge("current", "ok") : null,
          ),
          h("td", {}, p.owner ?? h("span", { class: "muted", title: "Created by Denis 0.0.x or the CLI; open to every group" }, "unowned")),
          h("td", { class: "num" }, formatNumber(p.keys)),
          h("td", { class: "num" }, formatNumber(p.tables)),
          h(
            "td",
            { class: "actions" },
            current ? null : button("Use", (e) => use(p, e.currentTarget), { small: true, kind: "primary" }),
            button("Delete", () => remove(p), { small: true, kind: "danger-ghost", iconName: "trash" }),
          ),
        );
      });
      replace(
        body,
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("caption", { class: "sr-only" }, "Projects visible to this group"),
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Token"), h("th", { scope: "col" }, "Owner"), h("th", { scope: "col", class: "num" }, "Keys"), h("th", { scope: "col", class: "num" }, "Tables"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
            h("tbody", {}, rows),
          ),
        ),
        h("p", { class: "muted small" }, `${projects.length} project${projects.length === 1 ? "" : "s"} visible to group ${st.group}${st.admin ? " (admin: all projects)" : ""}.`),
      );
    }

    async function use(p, btn) {
      await busy(btn, async () => {
        try {
          await api.db.use(p.token);
          toastSuccess(`Now using project ${shortToken(p.token)}.`);
          await load();
        } catch (err) {
          toastError(err, "Could not switch project");
        }
      });
    }

    async function create(btn) {
      await busy(btn, async () => {
        try {
          const token = await api.db.createProject();
          await load();
          const choice = await modal({
            title: "Project created",
            wide: true,
            body: [
              h("p", {}, "The new project token is below. It is needed to open the project from applications; keep it secret."),
              h("pre", { class: "token-box", tabindex: "0" }, token),
            ],
            actions: [
              { label: "Copy token", onClick: () => copy(token) },
              { label: "Close", value: "close" },
              { label: "Use this project", value: "use", kind: "primary" },
            ],
          });
          if (choice === "use") {
            await api.db.use(token);
            toastSuccess(`Now using project ${shortToken(token)}.`);
            await load();
          }
        } catch (err) {
          toastError(err, "AUTH CREATE failed");
        }
      });
    }

    async function remove(p) {
      const expected = p.token.slice(0, 8);
      const ok = await typedConfirm({
        title: "Delete project?",
        message: `This permanently deletes project ${shortToken(p.token)} with ${formatNumber(p.keys)} key(s) and ${formatNumber(p.tables)} table(s). This cannot be undone. Export it first if you may need the data.`,
        expected,
        confirmLabel: "Delete project",
      });
      if (!ok) return;
      try {
        await api.db.deleteProject(p.token);
        toastSuccess(`Project ${shortToken(p.token)} deleted.`);
        await load();
      } catch (err) {
        toastError(err, "Delete failed");
      }
    }

    load();
    return {
      refresh: load,
      onStatus(status, prev) {
        if (status.project !== prev.project || (status.state === "connected" && prev.state !== "connected")) load();
      },
    };
  },
};

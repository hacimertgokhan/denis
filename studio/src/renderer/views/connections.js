/**
 * Connections: saved profiles (add / edit / duplicate / delete), test, connect.
 */
import { h, replace, busy, field, uid } from "../util/dom.js";
import { pageHeader, card, badge, button, iconButton, emptyState, statList } from "../components/common.js";
import { toast, toastError, toastSuccess } from "../components/toast.js";
import { modal, confirmDialog, promptDialog } from "../components/dialog.js";
import { shortToken, formatMs, formatDate } from "../util/format.js";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

export default {
  id: "connections",
  title: "Connections",
  icon: "plug",
  needs: null,
  mount(root, ctx) {
    const { api, store } = ctx;
    let profiles = [];
    let storage = { encryptionAvailable: false, path: null };
    const currentBox = h("div");
    const notice = h("div");
    const list = h("div", { class: "profile-grid", role: "list", "aria-label": "Saved connections" });

    root.append(
      pageHeader("Connections", "Saved Denis servers. Passwords are encrypted by the operating system.", button("New connection", () => editProfile(null), { kind: "primary", iconName: "plus" })),
      currentBox,
      notice,
      list,
    );

    async function load() {
      try {
        [profiles, storage] = await Promise.all([api.profiles.list(), api.profiles.storage()]);
      } catch (err) {
        toastError(err, "Could not load profiles");
      }
      renderNotice();
      renderList();
      renderCurrent(store.get().status);
    }

    function renderNotice() {
      const parts = [];
      if (!storage.encryptionAvailable) {
        parts.push(
          h(
            "div",
            { class: "callout callout-warning", role: "note" },
            h("strong", {}, "Passwords cannot be saved securely on this system. "),
            "No OS keychain is available, so Denis Studio does not store passwords and asks for them on every connect.",
          ),
        );
      }
      if (storage.loadError) parts.push(h("div", { class: "callout callout-error", role: "alert" }, storage.loadError));
      if (storage.path) parts.push(h("p", { class: "muted small" }, "Profiles are stored in ", h("code", {}, storage.path)));
      replace(notice, parts);
    }

    function renderCurrent(st) {
      if (!st || st.state === "disconnected") {
        replace(currentBox);
        return;
      }
      const stateBadge =
        st.state === "connected"
          ? badge("connected", "ok")
          : st.state === "reconnecting"
            ? badge("reconnecting", "warn")
            : st.state === "connecting"
              ? badge("connecting", "neutral")
              : badge("failed", "error");
      replace(
        currentBox,
        card(
          null,
          h(
            "div",
            { class: "current-conn" },
            h("div", { class: "current-title" }, h("span", { class: "color-dot", style: { background: st.color || "#3b82f6" } }), h("h2", {}, st.name || `${st.host}:${st.port}`), stateBadge, st.admin ? badge("admin", "admin") : null),
            statList([
              ["Server", `${st.host}:${st.port}`],
              ["Group", st.group ? h("span", {}, st.group, " ", st.admin ? badge("admin", "admin", "Admin group: SAVE / BACKUP allowed") : badge("regular", "muted")) : "–"],
              ["Denis version", st.version ? `${st.version} (protocol ${st.protocol ?? "?"})` : "–"],
              ["Project", st.project ? h("span", { class: "mono", title: st.project }, shortToken(st.project)) : "none selected"],
              ["Latency", st.latencyMs !== undefined && st.latencyMs !== null ? formatMs(st.latencyMs) : "–"],
              ["Connected since", st.connectedAt ? formatDate(st.connectedAt) : "–"],
            ]),
            st.error && st.state !== "connected" ? h("div", { class: "callout callout-error", role: "alert" }, h("span", { class: "code-badge" }, st.error.code || "ERROR"), " ", st.error.message) : null,
            h(
              "div",
              { class: "row gap" },
              st.state === "connected" ? button("Dashboard", () => ctx.navigate("dashboard"), { iconName: "gauge" }) : null,
              st.state === "connected" && !st.project ? button("Choose a project", () => ctx.navigate("projects"), { iconName: "folder" }) : null,
              button("Disconnect", disconnect, { iconName: "unlink" }),
            ),
          ),
        ),
      );
    }

    function renderList() {
      if (profiles.length === 0) {
        replace(
          list,
          emptyState(
            "No saved connections",
            "Add the address of a Denis server (default port 5142) and the group to log in with.",
            button("New connection", () => editProfile(null), { kind: "primary", iconName: "plus" }),
          ),
        );
        return;
      }
      const active = store.get().status;
      replace(
        list,
        profiles.map((p) => {
          const isActive = active.profileId === p.id && active.state !== "disconnected";
          const connectBtn = button(isActive ? "Reconnect" : "Connect", (e) => connect(p, e.currentTarget), { kind: "primary", iconName: "link", small: true });
          return h(
            "article",
            { class: ["profile-card", isActive ? "active" : null], role: "listitem", style: { "--profile-color": p.color || "#3b82f6" }, "aria-label": p.name },
            h("div", { class: "profile-stripe", "aria-hidden": "true" }),
            h(
              "div",
              { class: "profile-main" },
              h("h3", { class: "profile-name" }, p.name, isActive ? badge("active", "ok") : null),
              h("div", { class: "profile-meta mono" }, `${p.group}@${p.host}:${p.port}`),
              h(
                "div",
                { class: "profile-meta" },
                p.token ? h("span", { title: p.token }, "project ", h("span", { class: "mono" }, shortToken(p.token))) : h("span", { class: "muted" }, "no default project"),
                " · ",
                p.hasPassword ? h("span", {}, "password saved") : h("span", { class: "muted" }, "asks for password"),
              ),
            ),
            h(
              "div",
              { class: "profile-actions" },
              connectBtn,
              button("Test", (e) => testProfile(p, e.currentTarget), { small: true }),
              iconButton("edit", `Edit ${p.name}`, () => editProfile(p)),
              iconButton("copy", `Duplicate ${p.name}`, () => duplicate(p)),
              iconButton("trash", `Delete ${p.name}`, () => remove(p)),
            ),
          );
        }),
      );
    }

    async function askPassword(p, reason) {
      return promptDialog({
        title: `Password for ${p.group}`,
        message: reason || `${p.name} (${p.host}:${p.port}) has no saved password.`,
        label: "Password",
        type: "password",
        confirmLabel: "Connect",
      });
    }

    async function connect(p, btn) {
      let password;
      if (!p.hasPassword) {
        password = await askPassword(p);
        if (password === null) return;
      }
      await busy(btn, async () => {
        try {
          const status = await api.conn.connect(p.id, password);
          toastSuccess(`Denis ${status.version || "?"} · group ${status.group}${status.admin ? " (admin)" : ""}`, `Connected to ${p.name}`);
          if (status.warning) toast(status.warning, { kind: "warning", title: "Project" });
          ctx.navigate(status.project ? "dashboard" : "projects");
        } catch (err) {
          if (err.code === "NEEDPASSWORD") {
            const pw = await askPassword(p, "The saved password could not be read. Enter it again.");
            if (pw !== null) {
              try {
                await api.conn.connect(p.id, pw);
                ctx.navigate("dashboard");
              } catch (err2) {
                toastError(err2, "Connection failed");
              }
            }
            return;
          }
          toastError(err, `Could not connect to ${p.name}`);
        }
      });
    }

    async function testProfile(p, btn) {
      let password;
      if (!p.hasPassword) {
        password = await askPassword(p, `Enter the password to test ${p.name}.`);
        if (password === null) return;
      }
      await busy(btn, async () => {
        try {
          const r = await api.conn.test({ profileId: p.id, host: p.host, port: p.port, group: p.group, token: p.token || undefined }, password);
          showTestResult(r);
        } catch (err) {
          toastError(err, "Test failed");
        }
      });
    }

    function showTestResult(r) {
      toastSuccess(`Denis ${r.version || "?"} (protocol ${r.protocol ?? "?"}) · group ${r.group}${r.admin ? " (admin)" : ""} · ${formatMs(r.latencyMs)}`, "Connection OK");
      if (r.projectError) toast(`Default project: ${r.projectError}`, { kind: "warning", title: "Project not accessible" });
    }

    async function disconnect() {
      try {
        await api.conn.disconnect();
        toast("Disconnected.");
      } catch (err) {
        toastError(err);
      }
    }

    async function duplicate(p) {
      try {
        await api.profiles.duplicate(p.id);
        await load();
      } catch (err) {
        toastError(err, "Duplicate failed");
      }
    }

    async function remove(p) {
      const ok = await confirmDialog({ title: "Delete connection?", message: `Delete the saved connection "${p.name}"? The server and its data are not touched.`, confirmLabel: "Delete", danger: true });
      if (!ok) return;
      try {
        await api.profiles.remove(p.id);
        toast(`Deleted ${p.name}.`);
        await load();
      } catch (err) {
        toastError(err, "Delete failed");
      }
    }

    async function editProfile(p) {
      const isNew = !p;
      const values = p || { name: "", host: "127.0.0.1", port: 5142, group: "", token: "", color: COLORS[profiles.length % COLORS.length] };
      const name = h("input", { class: "input", required: true, value: values.name, maxlength: "80", autocomplete: "off" });
      const host = h("input", { class: "input", required: true, value: values.host, autocomplete: "off", spellcheck: "false" });
      const port = h("input", { class: "input", required: true, type: "number", min: "1", max: "65535", value: String(values.port) });
      const group = h("input", { class: "input", required: true, value: values.group, autocomplete: "username", spellcheck: "false" });
      const password = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: p && p.hasPassword ? "(unchanged)" : "" });
      const remember = h("input", { type: "checkbox", checked: storage.encryptionAvailable && (isNew || p.hasPassword), disabled: !storage.encryptionAvailable });
      const token = h("input", { class: "input mono", value: values.token || "", autocomplete: "off", spellcheck: "false", placeholder: "optional: project to open after login" });
      const color = h("input", { class: "color-input", type: "color", value: values.color || COLORS[0] });
      const error = h("div", { class: "field-error", role: "alert" });
      const rememberId = uid("remember");
      remember.id = rememberId;

      const swatches = h(
        "div",
        { class: "swatches", role: "group", "aria-label": "Preset colors" },
        COLORS.map((c) => h("button", { type: "button", class: "swatch", style: { background: c }, "aria-label": `Color ${c}`, onclick: () => (color.value = c) })),
      );

      const readForm = () => ({
        ...(p ? { id: p.id } : {}),
        name: name.value.trim(),
        host: host.value.trim(),
        port: Number(port.value),
        group: group.value.trim(),
        token: token.value.trim(),
        color: color.value,
      });

      const check = (f) => {
        if (!f.name) return ["Name is required.", name];
        if (!f.host || /\s/.test(f.host)) return ["Host is required (no spaces).", host];
        if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) return ["Port must be 1-65535.", port];
        if (!f.group || /\s/.test(f.group)) return ["Group is required (one word).", group];
        if (/[\r\n]/.test(password.value)) return ["Password cannot contain line breaks.", password];
        if (f.token && !/^[A-Za-z0-9_\-.]+$/.test(f.token)) return ["Project token contains invalid characters.", token];
        return null;
      };

      const showError = (problem) => {
        error.textContent = problem[0];
        problem[1].setAttribute("aria-invalid", "true");
        problem[1].focus();
      };

      const testBtn = button(
        "Test connection",
        async (e) => {
          const f = readForm();
          const problem = check(f);
          if (problem) return showError(problem);
          const pw = password.value || undefined;
          if (pw === undefined && !(p && p.hasPassword)) {
            showError(["Enter the password to test.", password]);
            return;
          }
          error.textContent = "";
          await busy(e.currentTarget, async () => {
            try {
              const r = await api.conn.test({ ...(p ? { profileId: p.id } : {}), host: f.host, port: f.port, group: f.group, token: f.token || undefined }, pw);
              showTestResult(r);
            } catch (err) {
              error.textContent = `${err.code ? `[${err.code}] ` : ""}${err.message}`;
            }
          });
        },
        { iconName: "bolt" },
      );

      const body = h(
        "div",
        { class: "form-grid" },
        field("Name", name).wrap,
        h("div", { class: "field-row" }, field("Host", host).wrap, h("div", { class: "field-port" }, field("Port", port).wrap)),
        field("Group", group, "The group used with LIN (login).").wrap,
        field("Password", password, p && p.hasPassword ? "Leave empty to keep the saved password." : null).wrap,
        h(
          "div",
          { class: "checkbox-field" },
          remember,
          h("label", { for: rememberId }, "Remember password (encrypted by the OS)"),
          !storage.encryptionAvailable ? h("div", { class: "hint" }, "Unavailable: no secure storage on this system.") : null,
        ),
        field("Default project token", token, "Opened with AUTH after login. Leave empty to choose later.").wrap,
        h("div", { class: "field" }, h("label", { for: color.id || (color.id = uid("color")) }, "Color"), h("div", { class: "row gap" }, color, swatches)),
        h("div", { class: "row" }, testBtn),
        error,
      );

      await modal({
        title: isNew ? "New connection" : `Edit ${p.name}`,
        wide: true,
        body,
        initialFocus: name,
        actions: [
          { label: "Cancel", value: false },
          { label: isNew ? "Save connection" : "Save changes", kind: "primary", submit: true },
        ],
        onSubmit: async (close) => {
          const f = readForm();
          const problem = check(f);
          if (problem) return showError(problem);
          const secret = {};
          if (!remember.checked) secret.savePassword = false;
          else if (password.value) {
            secret.savePassword = true;
            secret.password = password.value;
          }
          try {
            const saved = await api.profiles.save(f, secret);
            if (saved.warning) toast(saved.warning, { kind: "warning" });
            toastSuccess(`${saved.profile.name} saved.`);
            close(true);
            await load();
          } catch (err) {
            error.textContent = err.message;
          }
        },
      });
    }

    load();

    return {
      refresh: load,
      onStatus(status, prev) {
        renderCurrent(status);
        if (status.state !== prev.state || status.profileId !== prev.profileId) renderList();
      },
    };
  },
};

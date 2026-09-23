/**
 * Settings: theme, dashboard refresh interval, default key list limit,
 * confirmation of destructive actions. Saved immediately.
 */
import { h, uid } from "../util/dom.js";
import { pageHeader, card, statList } from "../components/common.js";
import { toast, toastError } from "../components/toast.js";

export default {
  id: "settings",
  title: "Settings",
  icon: "gear",
  needs: null,
  mount(root, ctx) {
    const { api, store } = ctx;
    const s = store.get().settings;

    async function save(patch, message) {
      try {
        const next = await api.settings.set(patch);
        store.set({ settings: next });
        if (message) toast(message, { kind: "success", timeout: 1500 });
      } catch (err) {
        toastError(err, "Could not save settings");
      }
    }

    const themeName = uid("theme");
    const themes = [
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ].map(([value, label]) => {
      const id = uid("theme");
      const radio = h("input", { type: "radio", name: themeName, id, value, checked: s.theme === value });
      radio.addEventListener("change", () => radio.checked && save({ theme: value }));
      return h("div", { class: "radio-field" }, radio, h("label", { for: id }, label));
    });

    const refreshId = uid("refresh");
    const refresh = h(
      "select",
      { id: refreshId, class: "input input-auto" },
      [500, 1000, 2000, 5000, 10000, 30000].map((ms) => h("option", { value: String(ms), selected: s.refreshMs === ms }, ms < 1000 ? `${ms} ms` : `${ms / 1000} s`)),
    );
    if (![500, 1000, 2000, 5000, 10000, 30000].includes(s.refreshMs)) refresh.append(h("option", { value: String(s.refreshMs), selected: true }, `${s.refreshMs} ms`));
    refresh.addEventListener("change", () => save({ refreshMs: Number(refresh.value) }, "Refresh interval saved."));

    const limitId = uid("limit");
    const limit = h("input", { id: limitId, class: "input input-narrow", type: "number", min: "10", max: "100000", step: "10", value: String(s.keyLimit) });
    const limitError = h("div", { class: "field-error", role: "alert" });
    limit.addEventListener("change", () => {
      const n = Number(limit.value);
      if (!Number.isInteger(n) || n < 10 || n > 100000) {
        limitError.textContent = "Enter a whole number between 10 and 100000.";
        limit.setAttribute("aria-invalid", "true");
        return;
      }
      limitError.textContent = "";
      limit.removeAttribute("aria-invalid");
      save({ keyLimit: n }, "Key limit saved.");
    });

    const confirmId = uid("confirm");
    const confirm = h("input", { type: "checkbox", id: confirmId, checked: s.confirmDestructive });
    confirm.addEventListener("change", () => save({ confirmDestructive: confirm.checked }, confirm.checked ? "Confirmations on." : "Confirmations off (project deletion still asks)."));

    const info = store.get().appInfo || {};
    root.append(
      pageHeader("Settings", "Saved for this user; shared by all windows."),
      h(
        "div",
        { class: "settings-grid" },
        card("Appearance", h("fieldset", { class: "fieldset" }, h("legend", {}, "Theme"), h("div", { class: "radio-group" }, themes))),
        card(
          "Dashboard",
          h("div", { class: "field" }, h("label", { for: refreshId }, "Refresh interval"), refresh, h("div", { class: "hint" }, "How often INFO is polled while the dashboard is open.")),
        ),
        card("Keys", h("div", { class: "field" }, h("label", { for: limitId }, "Default key list limit"), limit, limitError, h("div", { class: "hint" }, "KEYS -&limit used by the Keys view. The server caps it with its keys-limit setting."))),
        card(
          "Safety",
          h("div", { class: "checkbox-field" }, confirm, h("label", { for: confirmId }, "Confirm destructive actions (delete key, clear cache, DROP/DELETE SQL…)")),
          h("p", { class: "hint" }, "Deleting a project always requires typing its token prefix."),
        ),
        card(
          "About",
          statList([
            ["Denis Studio", info.version ?? "–"],
            ["Electron", info.electron ?? "–"],
            ["Platform", info.platform ?? "–"],
            ["Profiles file", info.profilesPath ? h("code", { class: "wrap" }, info.profilesPath) : "–"],
            ["DevTools", info.devtools ? "enabled" : "disabled (set DENIS_STUDIO_DEVTOOLS=1)"],
          ]),
        ),
      ),
    );
    return {};
  },
};

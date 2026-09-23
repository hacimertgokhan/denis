/**
 * Keys: glob search with layer filter and limit, paginated list with layer
 * badges and TTL, detail panel with viewer/editor, delete, EXPIRE/PERSIST,
 * INCR and a "New key" dialog.
 */
import { h, replace, busy, field, uid } from "../util/dom.js";
import { pageHeader, badge, button, iconButton, emptyState, layerBadges } from "../components/common.js";
import { toast, toastError, toastSuccess } from "../components/toast.js";
import { modal, confirmDialog } from "../components/dialog.js";
import { formatTtl, formatNumber } from "../util/format.js";
import { keyError, checkValue, prepareValue, toEditorText, parseStructured, isIntegerValue, parseTtl } from "../util/values.js";

const PAGE_SIZE = 100;

export default {
  id: "keys",
  title: "Keys",
  icon: "key",
  needs: "project",
  mount(root, ctx) {
    const { api, store } = ctx;
    const state = {
      keys: [],
      truncated: false,
      page: 0,
      meta: new Map(),
      selected: null,
    };

    // ---------------------------------------------------------- search form
    const patternInput = h("input", { class: "input mono", value: "*", spellcheck: "false", autocomplete: "off", "aria-describedby": "pattern-hint" });
    const layerSelect = h(
      "select",
      { class: "input" },
      h("option", { value: "any" }, "All layers"),
      h("option", { value: "cache" }, "Cache only"),
      h("option", { value: "persistent" }, "Durable only"),
    );
    const limitInput = h("input", { class: "input", type: "number", min: "1", max: "100000", value: String(store.get().settings.keyLimit || 500) });
    const searchBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Search");
    const form = h(
      "form",
      { class: "search-form", role: "search", "aria-label": "Search keys" },
      h("div", { class: "field grow" }, h("label", { for: (patternInput.id = uid("pattern")) }, "Pattern"), patternInput, h("div", { class: "hint", id: "pattern-hint" }, "Glob: * any, ? one char, [a-z] range. Ctrl+K to focus.")),
      field("Layer", layerSelect).wrap,
      h("div", { class: "field field-narrow" }, h("label", { for: (limitInput.id = uid("limit")) }, "Limit"), limitInput),
      h("div", { class: "field field-button" }, searchBtn),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      search();
    });

    const summary = h("div", { class: "keys-summary", role: "status" });
    const listBox = h("div", { class: "keys-list" });
    const pager = h("div", { class: "pager" });
    const detail = h("section", { class: "key-detail", "aria-label": "Key details" });

    root.append(
      pageHeader(
        "Keys",
        "Every key has a cache value (memory) and/or a durable value (log, survives restarts).",
        button("New key", () => newKey(), { kind: "primary", iconName: "plus", title: "Ctrl+N" }),
        button("Clear cache…", () => clearCache(), { kind: "danger-ghost", small: true, title: "HEAVEN: drop every cache value of this project" }),
      ),
      form,
      h("div", { class: "split" }, h("div", { class: "split-left" }, summary, listBox, pager), detail),
    );
    renderDetailEmpty();

    // ---------------------------------------------------------- search & list
    async function search(keepSelection = false) {
      const pattern = patternInput.value.trim() || "*";
      if (/\s/.test(pattern) || pattern.startsWith("-&")) {
        summary.textContent = "The pattern must be one word (no spaces) and cannot start with -&.";
        patternInput.setAttribute("aria-invalid", "true");
        patternInput.focus();
        return;
      }
      patternInput.removeAttribute("aria-invalid");
      const limit = Math.max(1, Math.min(100000, Number(limitInput.value) || 500));
      await busy(searchBtn, async () => {
        try {
          const r = await api.db.keys({ pattern, layer: layerSelect.value, limit });
          state.keys = [...r.keys].sort((a, b) => a.localeCompare(b));
          state.truncated = r.truncated;
          state.limit = limit;
          state.page = 0;
          state.meta = new Map();
          await renderPage();
          if (!keepSelection || (state.selected && !state.keys.includes(state.selected))) {
            if (!keepSelection) renderDetailEmpty();
          }
        } catch (err) {
          toastError(err, "KEYS failed");
        }
      });
    }

    function updateSummary() {
      const n = state.keys.length;
      summary.textContent = `${formatNumber(n)} key${n === 1 ? "" : "s"}${state.truncated ? ` (limit ${formatNumber(state.limit)} reached: refine the pattern or raise the limit; the server also caps KEYS by its keys-limit)` : ""}`;
    }

    async function renderPage() {
      updateSummary();
      const pages = Math.max(1, Math.ceil(state.keys.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages - 1);
      const slice = state.keys.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
      if (state.keys.length === 0) {
        replace(listBox, emptyState("No keys", "Nothing matches this pattern. Create one with New key.", button("New key", () => newKey(), { iconName: "plus" })));
        replace(pager);
        return;
      }
      drawList(slice);
      replace(
        pager,
        button("Previous", () => goto(state.page - 1), { small: true, disabled: state.page === 0 }),
        h("span", { class: "muted small" }, `Page ${state.page + 1} of ${pages}`),
        button("Next", () => goto(state.page + 1), { small: true, disabled: state.page >= pages - 1 }),
      );
      const missing = slice.filter((k) => !state.meta.has(k));
      if (missing.length) {
        try {
          const metas = await api.db.keyMeta(missing);
          for (const m of metas) state.meta.set(m.key, m);
          drawList(slice);
        } catch (err) {
          if (err.code !== "ECONN") toastError(err, "Could not read key details");
        }
      }
    }

    function goto(page) {
      state.page = page;
      renderPage();
    }

    function drawList(slice) {
      const rows = slice.map((key) => {
        const m = state.meta.get(key);
        const selected = key === state.selected;
        return h(
          "tr",
          { class: selected ? "row-selected" : null, "aria-selected": selected ? "true" : "false" },
          h("td", { class: "key-cell" }, h("button", { type: "button", class: "link-btn mono", onclick: () => select(key), title: key }, key)),
          h("td", {}, m ? layerBadges(m) : h("span", { class: "muted" }, "…")),
          h("td", { class: "num" }, m ? formatTtl(m.cache ? m.ttl : -1) : ""),
        );
      });
      replace(
        listBox,
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table table-compact" },
            h("caption", { class: "sr-only" }, "Keys matching the pattern"),
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Key"), h("th", { scope: "col" }, "Layers"), h("th", { scope: "col", class: "num" }, "TTL"))),
            h("tbody", {}, rows),
          ),
        ),
      );
    }

    // ---------------------------------------------------------- detail
    function renderDetailEmpty() {
      replace(detail, h("div", { class: "detail-empty muted" }, "Select a key to view and edit its value."));
    }

    async function select(key) {
      state.selected = key;
      const slice = state.keys.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
      drawList(slice);
      replace(detail, h("div", { class: "detail-empty muted" }, "Loading…"));
      try {
        const [meta] = await api.db.keyMeta([key]);
        state.meta.set(key, meta);
        let cacheValue = null;
        let durableValue = null;
        if (meta.cache) cacheValue = await api.db.get(key, "default");
        if (meta.persistent) durableValue = await api.db.get(key, "persistent");
        if (state.selected !== key) return;
        drawList(state.keys.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE));
        renderDetail(key, meta, cacheValue, durableValue);
      } catch (err) {
        toastError(err, `Could not read ${key}`);
        renderDetailEmpty();
      }
    }

    function renderDetail(key, meta, cacheValue, durableValue) {
      if (!meta.exists) {
        replace(detail, h("div", { class: "detail-empty" }, h("p", {}, h("code", {}, key), " no longer exists (deleted or expired)."), button("Refresh list", () => search(true), { small: true })));
        return;
      }
      const differ = meta.cache && meta.persistent && cacheValue !== durableValue;
      let shownLayer = meta.cache ? "cache" : "persistent";
      const valueOf = (layer) => (layer === "cache" ? cacheValue : durableValue);

      const textarea = h("textarea", { class: "input mono value-editor", spellcheck: "false", rows: "14", "aria-label": `Value of ${key}` });
      const modeLabel = h("span", { class: "muted small" });
      const problems = h("div", { class: "value-problems", role: "status", "aria-live": "polite" });
      const asJsonId = uid("asjson");
      const asJson = h("input", { type: "checkbox", id: asJsonId });
      const asJsonWrap = h("div", { class: "checkbox-field", hidden: true }, asJson, h("label", { for: asJsonId }, "Store as JSON string (encodes line breaks and -& safely)"));
      const formatBtn = button("Format JSON", () => formatJson(), { small: true });
      const rawBtn = button("Edit as raw text", () => setMode("raw", textarea.value), { small: true });
      let mode = "raw";

      function setMode(next, text) {
        mode = next;
        textarea.value = text;
        modeLabel.textContent = mode === "json" ? "JSON value (pretty printed; saved compact)" : "Raw text";
        rawBtn.hidden = mode !== "json";
        formatBtn.hidden = mode === "json";
        validate();
      }

      function load(layer) {
        shownLayer = layer;
        const view = toEditorText(valueOf(layer) ?? "");
        setMode(view.mode, view.text);
        for (const t of tabs.querySelectorAll("[role=tab]")) t.setAttribute("aria-selected", String(t.dataset.layer === layer));
      }

      function formatJson() {
        const parsed = parseStructured(textarea.value);
        if (parsed.ok) setMode("json", JSON.stringify(parsed.value, null, 2));
        else toast("The value is not a JSON object or array.", { kind: "warning" });
      }

      function validate() {
        if (mode === "json" || asJson.checked) {
          const r = prepareValue(textarea.value, mode, { asJsonString: asJson.checked });
          asJsonWrap.hidden = mode === "json" && !asJson.checked;
          replace(problems, r.ok ? [] : h("div", { class: "field-error" }, r.error));
          return r;
        }
        const c = checkValue(textarea.value);
        asJsonWrap.hidden = c.ok && c.warnings.length === 0;
        replace(
          problems,
          c.ok ? [] : h("ul", { class: "field-error" }, c.problems.map((p) => h("li", {}, p))),
          c.warnings.map((w) => h("div", { class: "hint" }, w)),
        );
        return prepareValue(textarea.value, mode);
      }
      textarea.addEventListener("input", validate);
      asJson.addEventListener("change", validate);

      const tabs = h(
        "div",
        { class: "tabs", role: "tablist", "aria-label": "Layer shown" },
        ...(differ
          ? [
              h("button", { type: "button", role: "tab", class: "tab", dataset: { layer: "cache" }, onclick: () => load("cache") }, "Cache value"),
              h("button", { type: "button", role: "tab", class: "tab", dataset: { layer: "persistent" }, onclick: () => load("persistent") }, "Durable value"),
            ]
          : []),
      );

      const ttlInput = h("input", { class: "input input-narrow", type: "number", min: "1", placeholder: "none", "aria-label": "TTL in seconds for the cache value" });
      const saveCache = button("Save to cache", () => save(false), { title: "SET (cache value only)" });
      const saveDurable = button("Save durable", () => save(true), { kind: "primary", title: "SET -&save (cache and durable value)", iconName: "save" });

      async function save(persist) {
        const r = validate();
        if (!r.ok) {
          textarea.focus();
          return;
        }
        const ttl = parseTtl(ttlInput.value);
        if (!ttl.ok) {
          toast(ttl.error, { kind: "warning" });
          ttlInput.focus();
          return;
        }
        await busy([saveCache, saveDurable], async () => {
          try {
            await api.db.set({ key, value: r.value, persist, ...(ttl.value ? { ttl: ttl.value } : {}) });
            toastSuccess(`${key} saved${persist ? " (cache + durable)" : " (cache)"}.`);
            await select(key);
          } catch (err) {
            toastError(err, "SET failed");
          }
        });
      }

      textarea.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          save(meta.persistent);
        }
      });

      // delete
      const delLayer = h(
        "select",
        { class: "input", "aria-label": "Layer to delete" },
        h("option", { value: "both" }, "both layers"),
        meta.cache ? h("option", { value: "cache" }, "cache only") : null,
        meta.persistent ? h("option", { value: "persistent" }, "durable only") : null,
      );
      const delBtn = button("Delete", () => remove(), { kind: "danger", iconName: "trash" });
      async function remove() {
        const layer = delLayer.value;
        const ok = await confirmDialog({ title: `Delete ${key}?`, message: `Delete the ${layer === "both" ? "cache and durable values" : layer === "cache" ? "cache value" : "durable value"} of "${key}"?`, confirmLabel: "Delete", danger: true });
        if (!ok) return;
        try {
          await api.db.del(key, layer);
          toastSuccess(`${key} deleted (${layer}).`);
          state.meta.delete(key);
          if (layer === "both") {
            state.keys = state.keys.filter((k) => k !== key);
            state.selected = null;
            renderDetailEmpty();
            renderPage();
          } else {
            await select(key);
          }
        } catch (err) {
          toastError(err, "DEL failed");
        }
      }

      // TTL
      const expireInput = h("input", { class: "input input-narrow", type: "number", min: "1", placeholder: "seconds", "aria-label": "Expire after seconds" });
      const expireBtn = button("Expire", () => expire(), { small: true, iconName: "clock", title: "EXPIRE: set a TTL on the cache value" });
      const persistBtn = button("Persist", () => persistTtl(), { small: true, title: "PERSIST: remove the TTL" });
      async function expire() {
        const t = parseTtl(expireInput.value);
        if (!t.ok || !t.value) {
          toast(t.error || "Enter the number of seconds.", { kind: "warning" });
          expireInput.focus();
          return;
        }
        try {
          const updated = await api.db.expire(key, t.value);
          toast(updated ? `${key} expires in ${formatTtl(t.value)}.` : `${key} has no cache value; TTL applies to cache values only.`, { kind: updated ? "success" : "warning" });
          await select(key);
        } catch (err) {
          toastError(err, "EXPIRE failed");
        }
      }
      async function persistTtl() {
        try {
          await api.db.persist(key);
          toastSuccess(`TTL of ${key} removed.`);
          await select(key);
        } catch (err) {
          toastError(err, "PERSIST failed");
        }
      }

      // INCR
      const current = valueOf(shownLayer);
      let incrRow = null;
      if (isIntegerValue(current)) {
        const deltaInput = h("input", { class: "input input-narrow", type: "number", step: "1", value: "1", "aria-label": "Delta" });
        const incrDurableId = uid("incrdur");
        const incrDurable = h("input", { type: "checkbox", id: incrDurableId, checked: meta.persistent });
        incrRow = h(
          "div",
          { class: "action-row" },
          h("span", { class: "action-label" }, "Counter"),
          deltaInput,
          button(
            "INCR",
            async (e) => {
              const delta = Number(deltaInput.value);
              if (!Number.isInteger(delta)) {
                toast("Delta must be a whole number.", { kind: "warning" });
                return;
              }
              await busy(e.currentTarget, async () => {
                try {
                  const value = await api.db.incr(key, delta, incrDurable.checked);
                  toastSuccess(`${key} = ${value}`);
                  await select(key);
                } catch (err) {
                  toastError(err, "INCR failed");
                }
              });
            },
            { small: true, title: "Atomic increment (negative delta decrements)" },
          ),
          h("span", { class: "checkbox-field inline" }, incrDurable, h("label", { for: incrDurableId }, "durable")),
        );
      }

      const ttlText = meta.cache ? formatTtl(meta.ttl) : "durable only (TTL applies to cache values)";
      replace(
        detail,
        h(
          "div",
          { class: "detail-head" },
          h("h2", { class: "detail-key mono", title: key }, key),
          iconButton("copy", "Copy key name", () => api.app.copy(key).then(() => toast("Key copied.", { kind: "success", timeout: 1500 }), toastError)),
          iconButton("refresh", "Reload value", () => select(key)),
        ),
        h("div", { class: "detail-badges" }, layerBadges(meta), h("span", { class: "muted small" }, "TTL: ", ttlText)),
        differ ? h("div", { class: "callout callout-info" }, "The cache and durable values differ.") : null,
        tabs,
        h("div", { class: "editor-head" }, modeLabel, h("div", { class: "row gap-sm" }, formatBtn, rawBtn)),
        textarea,
        problems,
        asJsonWrap,
        h(
          "div",
          { class: "action-row" },
          h("label", { class: "action-label", for: (ttlInput.id = uid("ttl")) }, "TTL (s)"),
          ttlInput,
          saveCache,
          saveDurable,
        ),
        meta.persistent ? h("p", { class: "hint" }, "Save to cache only leaves the durable value unchanged. Ctrl+Enter saves durable.") : h("p", { class: "hint" }, "Ctrl+Enter saves to the cache."),
        h("div", { class: "action-row" }, h("span", { class: "action-label" }, "TTL"), expireInput, expireBtn, meta.cache && meta.ttl > 0 ? persistBtn : null),
        incrRow,
        h("div", { class: "action-row danger-zone" }, h("span", { class: "action-label" }, "Delete"), delLayer, delBtn),
      );
      load(shownLayer);
    }

    // ---------------------------------------------------------- new key
    async function newKey() {
      const keyInput = h("input", { class: "input mono", autocomplete: "off", spellcheck: "false" });
      const valueInput = h("textarea", { class: "input mono", rows: "8", spellcheck: "false" });
      const durableId = uid("durable");
      const durable = h("input", { type: "checkbox", id: durableId, checked: true });
      const asJsonId = uid("asjson");
      const asJson = h("input", { type: "checkbox", id: asJsonId });
      const ttlInput = h("input", { class: "input input-narrow", type: "number", min: "1", placeholder: "none" });
      const error = h("div", { class: "field-error", role: "alert" });
      const asJsonWrap = h("div", { class: "checkbox-field", hidden: true }, asJson, h("label", { for: asJsonId }, "Store as JSON string (keeps line breaks / -& safely)"));

      const compute = () => {
        const structured = parseStructured(valueInput.value);
        const mode = structured.ok ? "json" : "raw";
        const r = prepareValue(valueInput.value, mode, { asJsonString: asJson.checked });
        if (!r.ok && r.canEncode) asJsonWrap.hidden = false;
        if (asJson.checked) asJsonWrap.hidden = false;
        return r;
      };
      valueInput.addEventListener("input", () => {
        const r = compute();
        error.textContent = r.ok ? "" : r.error;
      });
      asJson.addEventListener("change", () => {
        const r = compute();
        error.textContent = r.ok ? "" : r.error;
      });

      let created = null;
      await modal({
        title: "New key",
        wide: true,
        body: h(
          "div",
          { class: "form-grid" },
          field("Key", keyInput, "One word, no spaces.").wrap,
          field("Value", valueInput, "JSON objects and arrays are stored compact. Values cannot contain line breaks unless stored as a JSON string.").wrap,
          asJsonWrap,
          h("div", { class: "row gap" }, h("span", { class: "checkbox-field inline" }, durable, h("label", { for: durableId }, "Durable (survives restarts)")), h("label", { for: (ttlInput.id = uid("ttl")) }, "TTL (s)"), ttlInput),
          error,
        ),
        initialFocus: keyInput,
        actions: [
          { label: "Cancel", value: false },
          { label: "Create", kind: "primary", submit: true },
        ],
        onSubmit: async (close) => {
          const key = keyInput.value.trim();
          const kerr = keyError(key);
          if (kerr) {
            error.textContent = kerr;
            keyInput.focus();
            return;
          }
          const r = compute();
          if (!r.ok) {
            error.textContent = r.error;
            valueInput.focus();
            return;
          }
          const ttl = parseTtl(ttlInput.value);
          if (!ttl.ok) {
            error.textContent = ttl.error;
            ttlInput.focus();
            return;
          }
          try {
            const [existing] = await api.db.keyMeta([key]);
            if (existing.exists) {
              const ok = await confirmDialog({ title: "Overwrite?", message: `"${key}" already exists. Overwrite its value?`, confirmLabel: "Overwrite", danger: true, force: true });
              if (!ok) return;
            }
            await api.db.set({ key, value: r.value, persist: durable.checked, ...(ttl.value ? { ttl: ttl.value } : {}) });
            created = key;
            close(true);
          } catch (err) {
            error.textContent = `${err.code ? `[${err.code}] ` : ""}${err.message}`;
          }
        },
      });
      if (created) {
        toastSuccess(`${created} created.`);
        if (!state.keys.includes(created)) state.keys = [...state.keys, created].sort((a, b) => a.localeCompare(b));
        state.page = Math.floor(state.keys.indexOf(created) / PAGE_SIZE);
        state.meta.delete(created);
        await renderPage();
        await select(created);
      }
    }

    async function clearCache() {
      const ok = await confirmDialog({
        title: "Clear the cache?",
        message: "HEAVEN drops every cache value of this project. Durable values stay. Keys that only exist in the cache are lost.",
        confirmLabel: "Clear cache",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.db.clearCache();
        toastSuccess("Cache cleared.");
        await search();
      } catch (err) {
        toastError(err, "HEAVEN failed");
      }
    }

    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        patternInput.focus();
        patternInput.select();
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        newKey();
      }
    };
    document.addEventListener("keydown", onKey);

    search();

    return {
      refresh: () => search(true).then(() => state.selected && select(state.selected)),
      unmount() {
        document.removeEventListener("keydown", onKey);
      },
    };
  },
};

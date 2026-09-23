/**
 * Console: raw protocol lines with history (Up/Down), pretty-printed JSON
 * replies. LIN asks for confirmation (password sent in clear text; masked
 * in history). MODE/EXIT are refused (see src/main/console-commands.js).
 */
import { h, replace, uid } from "../util/dom.js";
import { pageHeader, button } from "../components/common.js";
import { toastError } from "../components/toast.js";
import { confirmDialog } from "../components/dialog.js";
import { HistoryNav } from "../util/history-nav.js";
import { formatMs, shortToken } from "../util/format.js";

const MAX_ENTRIES = 300;

export default {
  id: "console",
  title: "Console",
  icon: "terminal",
  needs: "connection",
  mount(root, ctx) {
    const { api } = ctx;
    const nav = new HistoryNav([]);
    const inputId = uid("console");
    const output = h("div", { class: "console-output", role: "log", "aria-live": "polite", "aria-label": "Console output", tabindex: "0" });
    const input = h("input", { id: inputId, class: "input mono console-input", autocomplete: "off", spellcheck: "false", placeholder: "e.g. DBSIZE, KEYS user:* -&limit=20, HELP" });
    const sendBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Send");
    const form = h("form", { class: "console-form" }, h("label", { for: inputId, class: "prompt mono" }, "›"), input, sendBtn);

    root.append(
      pageHeader(
        "Console",
        "Send raw protocol commands (docs/PROTOCOL.md). Replies are shown as JSON.",
        button("Clear output", () => replace(output), { small: true }),
        button("Clear history", async () => {
          nav.setEntries(await api.history.clear("console"));
        }, { small: true }),
      ),
      output,
      form,
      h("p", { class: "hint" }, "Up/Down: history · the session stays in JSON mode · LIN logs the whole window in again · AUTH <token> switches the project."),
    );

    function append(entry) {
      output.append(entry);
      while (output.children.length > MAX_ENTRIES) output.firstElementChild.remove();
      output.scrollTop = output.scrollHeight;
    }

    function echo(shown) {
      return h("div", { class: "console-cmd mono" }, h("span", { class: "prompt", "aria-hidden": "true" }, "› "), shown);
    }

    function show(shown, body, kind = "reply", meta) {
      append(h("div", { class: ["console-entry", `console-${kind}`] }, echo(shown), body, meta ? h("div", { class: "console-meta muted small" }, meta) : null));
    }

    async function send(line, confirmed = false) {
      try {
        const r = await api.console.send(line, confirmed ? { confirmed: true } : undefined);
        switch (r.kind) {
          case "empty":
            return;
          case "refused":
            show(r.shown, h("div", { class: "console-note" }, r.message), "refused");
            break;
          case "confirm": {
            const ok = await confirmDialog({
              title: "Send LIN?",
              message: `${r.message} The password is visible in this window while you type it and is masked in the history. Continue?`,
              confirmLabel: "Log in",
              force: true,
            });
            if (ok) return send(line, true);
            show(r.shown, h("div", { class: "console-note" }, "Not sent."), "refused");
            break;
          }
          case "session": {
            const st = r.status || {};
            show(r.shown, h("pre", { class: "console-json" }, JSON.stringify({ ok: true, group: st.group, admin: st.admin, project: st.project ? shortToken(st.project) : null }, null, 2)), "reply", "session updated for the whole window");
            break;
          }
          default: {
            const ok = r.reply && r.reply.ok !== false;
            show(r.shown, h("pre", { class: "console-json" }, JSON.stringify(r.reply, null, 2)), ok ? "reply" : "error", formatMs(r.ms));
          }
        }
        nav.setEntries(await api.history.add("console", line));
      } catch (err) {
        show(line.replace(/^(\s*LIN\s+\S+\s+).+$/i, "$1********"), h("div", { class: "console-note" }, `${err.code || "ERROR"}: ${err.message}`), "error");
        if (err.code !== "EINVAL") toastError(err, "Command failed");
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const line = input.value;
      if (!line.trim()) return;
      input.value = "";
      nav.reset();
      await send(line);
      input.focus();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        const t = nav.up(input.value);
        if (t !== null) {
          e.preventDefault();
          input.value = t;
          input.setSelectionRange(t.length, t.length);
        }
      } else if (e.key === "ArrowDown") {
        const t = nav.down();
        if (t !== null) {
          e.preventDefault();
          input.value = t;
        }
      }
    });
    input.addEventListener("paste", (e) => {
      // one line only: turn pasted line breaks into spaces
      const text = e.clipboardData && e.clipboardData.getData("text");
      if (text && /[\r\n]/.test(text)) {
        e.preventDefault();
        input.setRangeText(text.replace(/\r?\n/g, " "), input.selectionStart, input.selectionEnd, "end");
      }
    });

    api.history
      .list("console")
      .then((entries) => nav.setEntries(entries))
      .catch(() => {});
    setTimeout(() => input.focus(), 0);
    return {};
  },
};

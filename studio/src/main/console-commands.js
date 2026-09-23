"use strict";

/**
 * Raw console lines need care because the studio talks to Denis over a pool
 * of connections that must all stay in the same state (JSON mode, same group,
 * same project):
 *
 *  - `MODE text` would break reply parsing, `EXIT`/`QUIT` would close one
 *    pooled connection: both are refused with an explanation.
 *  - `LIN <group> <password>` logs the whole session in again (all pooled
 *    connections), after a confirmation in the UI. The password is masked in
 *    history and never logged.
 *  - `AUTH <token>` switches the project of the whole session.
 *  - `AUTH DELETE <token>` deletes through the manager so the session is reset
 *    when the current project disappears.
 *  - everything else is sent as-is on one pooled connection.
 */

function splitFirst(line) {
  const trimmed = line.trim();
  const space = trimmed.indexOf(" ");
  return space < 0 ? [trimmed, ""] : [trimmed.slice(0, space), trimmed.slice(space + 1)];
}

/**
 * @param {string} line
 * @returns {{kind: "empty"|"refuse"|"lin"|"auth-use"|"auth-delete"|"auth-create"|"raw", line: string, reason?: string, group?: string, password?: string, token?: string}}
 */
function classify(line) {
  const text = String(line ?? "").trim();
  if (!text) return { kind: "empty", line: text };
  const [word, rest] = splitFirst(text);
  const command = word.toUpperCase();
  switch (command) {
    case "MODE":
      return { kind: "refuse", line: text, reason: "Denis Studio needs JSON mode; MODE cannot be changed from the console." };
    case "EXIT":
    case "QUIT":
      return { kind: "refuse", line: text, reason: "Use the Disconnect button to close the connection." };
    case "LIN": {
      // the password is everything after the group name and may contain spaces
      const space = rest.indexOf(" ");
      if (!rest || space < 0) return { kind: "raw", line: text };
      return { kind: "lin", line: text, group: rest.slice(0, space), password: rest.slice(space + 1) };
    }
    case "AUTH": {
      const [sub, arg] = splitFirst(rest);
      if (!sub) return { kind: "raw", line: text };
      if (sub.toUpperCase() === "CREATE") return { kind: "auth-create", line: text };
      if (sub.toUpperCase() === "DELETE") {
        if (!arg.trim()) return { kind: "raw", line: text };
        return { kind: "auth-delete", line: text, token: arg.trim() };
      }
      return { kind: "auth-use", line: text, token: sub };
    }
    default:
      return { kind: "raw", line: text };
  }
}

/** The line as it may be shown in history/logs: LIN passwords are masked. */
function maskSecrets(line) {
  const text = String(line ?? "");
  const m = /^(\s*LIN\s+\S+\s+)(.+)$/i.exec(text);
  if (m) return `${m[1]}********`;
  return text;
}

module.exports = { classify, maskSecrets };

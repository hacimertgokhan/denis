/**
 * Renderer-side access to the preload bridge (`window.studio`).
 *
 * Every bridge call resolves with {ok, value} | {ok:false, error}; this
 * module unwraps it and throws an ApiError carrying the server/studio error
 * code (NOTFOUND, AUTH, SQL, FORBIDDEN, ECONN, EINVAL, ...).
 */

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApiError";
    this.code = code || "ERROR";
  }
}

const bridge = window.studio;

function wrap(fn) {
  return async (...args) => {
    const envelope = await fn(...args);
    if (envelope && envelope.ok === true) return envelope.value;
    const error = (envelope && envelope.error) || { message: "Unexpected reply from the main process", code: "INTERNAL" };
    throw new ApiError(error.message, error.code);
  };
}

function wrapGroup(group) {
  const out = {};
  for (const [name, fn] of Object.entries(group)) {
    // on* functions are event subscriptions, not calls
    out[name] = name.startsWith("on") ? fn : wrap(fn);
  }
  return out;
}

export const api = Object.freeze(
  Object.fromEntries(Object.entries(bridge || {}).map(([group, fns]) => [group, Object.freeze(wrapGroup(fns))])),
);

export const bridgeAvailable = !!bridge;

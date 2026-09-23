/**
 * Tiny observable state for the window.
 *
 *   state.status   connection status from the main process
 *   state.settings user settings
 */

export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get() {
      return state;
    },
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...listeners]) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore({
  status: { state: "disconnected" },
  settings: { theme: "system", refreshMs: 2000, keyLimit: 500, confirmDestructive: true },
  appInfo: null,
});

export const isConnected = (s = store.get()) => s.status.state === "connected";
export const hasProject = (s = store.get()) => isConnected(s) && !!s.status.project;

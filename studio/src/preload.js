"use strict";

/**
 * Preload (sandboxed). Exposes `window.studio` with a fixed set of functions;
 * there is deliberately no generic "invoke any channel" function. Every call
 * resolves with an envelope {ok, value} / {ok:false, error:{message, code}}
 * that the renderer's api.js unwraps. Arguments are validated again in the
 * main process.
 */

const { contextBridge, ipcRenderer } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

/** Subscribe to one fixed event channel; returns an unsubscribe function. */
const listen = (channel) => (callback) => {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("studio", {
  profiles: {
    list: call("profiles:list"),
    storage: call("profiles:storage"),
    save: call("profiles:save"),
    remove: call("profiles:delete"),
    duplicate: call("profiles:duplicate"),
  },
  conn: {
    test: call("conn:test"),
    connect: call("conn:connect"),
    disconnect: call("conn:disconnect"),
    status: call("conn:status"),
    onStatus: listen("conn:status"),
  },
  db: {
    info: call("db:info"),
    dbsize: call("db:dbsize"),
    projects: call("db:projects"),
    createProject: call("db:createProject"),
    deleteProject: call("db:deleteProject"),
    use: call("db:use"),
    keys: call("db:keys"),
    keyMeta: call("db:keyMeta"),
    get: call("db:get"),
    set: call("db:set"),
    del: call("db:del"),
    expire: call("db:expire"),
    persist: call("db:persist"),
    incr: call("db:incr"),
    clearCache: call("db:clearCache"),
    query: call("db:query"),
    save: call("db:save"),
    backup: call("db:backup"),
    backups: call("db:backups"),
  },
  console: {
    send: call("console:send"),
  },
  dump: {
    exportProject: call("dump:export"),
    open: call("dump:open"),
    importFile: call("dump:import"),
    discard: call("dump:discard"),
    onProgress: listen("import:progress"),
  },
  result: {
    exportFile: call("result:export"),
  },
  app: {
    copy: call("app:copy"),
    copyRows: call("app:copyRows"),
    newWindow: call("app:newWindow"),
    info: call("app:info"),
    onMenu: listen("app:menu"),
  },
  settings: {
    get: call("settings:get"),
    set: call("settings:set"),
    onChanged: listen("settings:changed"),
  },
  history: {
    list: call("history:list"),
    add: call("history:add"),
    clear: call("history:clear"),
  },
});

"use strict";

/**
 * One Denis connection per window.
 *
 * States: "disconnected" -> "connecting" -> "connected" <-> "reconnecting"
 *                                        \-> "error" (login refused, ...)
 *
 * Every operation goes through `run()`, which measures latency, turns client
 * errors into StudioErrors and, when the TCP connection is lost (server
 * restart, network), switches to "reconnecting" and retries in the background
 * with a backoff by creating a fresh client (LIN + AUTH again). The failed
 * operation itself is reported to the caller; later ones work again once the
 * connection is back.
 *
 * The client factory is injected so the manager can be tested with a stub or
 * against a fake TCP server.
 */

const { EventEmitter } = require("node:events");
const { createApi, normalizeError, isConnectionError, StudioError } = require("./denis-api");

const DEFAULT_OPTIONS = {
  poolSize: 2,
  connectTimeout: 5000,
  commandTimeout: 30000,
  heartbeatMs: 5000,
  reconnectDelays: [500, 1000, 2000, 4000, 8000, 10000],
};

class ConnectionManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {(options: object) => object} o.createClient  returns a DenisClient-like object
   * @param {object} [o.options]
   * @param {{info?: Function, warn?: Function}} [o.logger]
   */
  constructor({ createClient, options = {}, logger = console }) {
    super();
    this.createClient = createClient;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logger = logger;
    this.client = null;
    this.api = null;
    this.target = null; // {profileId, name, host, port, group, token, color}
    this.password = null; // kept in memory only for reconnects; never logged
    this.status = { state: "disconnected" };
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.reconnectAttempt = 0;
    this.generation = 0; // bumps on every (re)connect/disconnect to drop stale results
  }

  getStatus() {
    return { ...this.status };
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }

  _clientOptions(target, password, token) {
    return {
      host: target.host,
      port: target.port,
      group: target.group,
      password,
      token: token || undefined,
      poolSize: this.options.poolSize,
      connectTimeout: this.options.connectTimeout,
      commandTimeout: this.options.commandTimeout,
      // the manager reconnects itself; a client that also reconnects is fine
      reconnect: true,
    };
  }

  /** Create a client, connect, and read HELLO/WHOAMI. Closes the client on failure. */
  async _open(target, password, token) {
    const client = this.createClient(this._clientOptions(target, password, token));
    // denis-client is an EventEmitter: a slot that cannot be re-opened reports "error".
    if (typeof client.on === "function") client.on("error", (err) => this._onClientError(client, err));
    const api = createApi(client);
    try {
      if (typeof client.connect === "function") await client.connect();
      const started = Date.now();
      const hello = await api.hello();
      const who = await api.whoami();
      return { client, api, hello, who, latencyMs: Date.now() - started };
    } catch (err) {
      await safeClose(client);
      throw normalizeError(err);
    }
  }

  /**
   * Connect to a server. Resolves with the new status.
   * @param {{profileId?: string, name?: string, host: string, port: number, group: string, token?: string, color?: string}} target
   * @param {string} password
   */
  async connect(target, password) {
    await this.disconnect();
    const generation = ++this.generation;
    this.target = { ...target };
    this.password = password;
    this._setStatus({
      state: "connecting",
      profileId: target.profileId ?? null,
      name: target.name ?? `${target.host}:${target.port}`,
      host: target.host,
      port: target.port,
      group: target.group,
      color: target.color ?? null,
      error: null,
    });
    let opened;
    try {
      opened = await this._open(this.target, password, target.token);
    } catch (err) {
      // a stale default token should not prevent connecting: retry without project
      if (target.token && (err.code === "AUTH" || err.code === "NOPROJECT") && !/login/i.test(err.message)) {
        try {
          opened = await this._open(this.target, password, undefined);
          opened.projectWarning = `Default project could not be opened (${err.message}); connected without a project.`;
        } catch (err2) {
          err = err2;
        }
      }
      if (!opened) {
        if (generation === this.generation) {
          this.password = null;
          this._setStatus({ state: "error", error: { message: err.message, code: err.code } });
        }
        throw err;
      }
    }
    if (generation !== this.generation) {
      await safeClose(opened.client);
      throw new StudioError("connection attempt superseded", "ECANCELED");
    }
    this._adopt(opened);
    this._startHeartbeat();
    return { ...this.getStatus(), warning: opened.projectWarning };
  }

  _adopt({ client, api, hello, who, latencyMs }) {
    this.client = client;
    this.api = api;
    this.reconnectAttempt = 0;
    if (this.target) this.target.token = who.project || undefined;
    this._setStatus({
      state: "connected",
      version: hello.version ?? null,
      protocol: hello.protocol ?? null,
      features: Array.isArray(hello.features) ? hello.features : [],
      group: who.group ?? this.target.group,
      admin: who.admin,
      project: who.project,
      latencyMs,
      error: null,
      clientMode: api.modern ? "native" : "command-fallback",
      connectedAt: new Date().toISOString(),
    });
  }

  async disconnect() {
    this.generation++;
    this._stopTimers();
    const client = this.client;
    this.client = null;
    this.api = null;
    this.password = null;
    this.target = null;
    if (client) await safeClose(client);
    if (this.status.state !== "disconnected") this._setStatus({ state: "disconnected", error: null, latencyMs: null });
  }

  _stopTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!this.options.heartbeatMs) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.status.state !== "connected" || !this.api) return;
      const since = Date.now() - (this.lastActivity || 0);
      if (since < this.options.heartbeatMs) return; // traffic already proves liveness
      this.run((api) => api.ping()).catch(() => {});
    }, this.options.heartbeatMs);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /**
   * Run an operation against the API.
   * @template T
   * @param {(api: ReturnType<typeof createApi>) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    if (!this.api) {
      if (this.status.state === "reconnecting") throw new StudioError("Connection lost; reconnecting...", "ECONN");
      throw new StudioError("Not connected", "NOTCONNECTED");
    }
    const api = this.api;
    const generation = this.generation;
    const started = Date.now();
    try {
      const result = await fn(api);
      this.lastActivity = Date.now();
      if (generation === this.generation) this._setStatus({ latencyMs: Date.now() - started });
      return result;
    } catch (raw) {
      const err = normalizeError(raw);
      if (isConnectionError(err) && generation === this.generation) this._connectionLost(err);
      throw err;
    }
  }

  _onClientError(client, raw) {
    if (client !== this.client) return;
    const err = normalizeError(raw);
    if (isConnectionError(err)) this._connectionLost(err);
  }

  _connectionLost(err) {
    if (!this.target || this.status.state === "reconnecting") return;
    this.logger.warn?.(`[studio] connection to ${this.target.host}:${this.target.port} lost (${err.code}); reconnecting`);
    const old = this.client;
    this.client = null;
    this.api = null;
    this.generation++;
    if (old) safeClose(old);
    this.reconnectAttempt = 0;
    this._setStatus({ state: "reconnecting", error: { message: err.message, code: err.code }, attempt: 0 });
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    const delays = this.options.reconnectDelays;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
    const generation = this.generation;
    this.reconnectTimer = setTimeout(() => this._tryReconnect(generation), delay);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  async _tryReconnect(generation) {
    if (generation !== this.generation || !this.target) return;
    this.reconnectAttempt++;
    this._setStatus({ attempt: this.reconnectAttempt });
    try {
      const opened = await this._open(this.target, this.password, this.target.token);
      if (generation !== this.generation) {
        await safeClose(opened.client);
        return;
      }
      this._adopt(opened);
      this.emit("reconnected", this.getStatus());
    } catch (err) {
      if (generation !== this.generation) return;
      if (err.code === "AUTH" || err.code === "LOCKED") {
        // credentials no longer valid: stop retrying
        this.password = null;
        this._setStatus({ state: "error", error: { message: err.message, code: err.code } });
        return;
      }
      this._setStatus({ error: { message: err.message, code: err.code } });
      this._scheduleReconnect();
    }
  }

  /** Switch the current project of the whole connection. */
  async use(token) {
    const done = await this.run((api) => api.use(token));
    if (!done) {
      // client cannot switch all pooled connections: reconnect with the new token
      const opened = await this._open(this.target, this.password, token);
      const old = this.client;
      this.generation++;
      this._adopt(opened);
      if (old) safeClose(old);
    } else {
      this.target.token = token;
      this._setStatus({ project: token });
    }
    return this.getStatus();
  }

  /** Delete a project; when it was the current one, the session has no project afterwards. */
  async deleteProject(token) {
    await this.run((api) => api.deleteProject(token));
    if (this.status.project === token) {
      this.target.token = undefined;
      // pooled connections may still point at the deleted project: reopen cleanly
      const opened = await this._open(this.target, this.password, undefined);
      const old = this.client;
      this.generation++;
      this._adopt(opened);
      if (old) safeClose(old);
    }
    return this.getStatus();
  }

  /** Log in again as another group (typed LIN in the console). */
  async relogin(group, password) {
    if (!this.target) throw new StudioError("Not connected", "NOTCONNECTED");
    const target = { ...this.target, group, token: undefined };
    const opened = await this._open(target, password, undefined);
    const old = this.client;
    this.generation++;
    this.target = target;
    this.password = password;
    this._adopt(opened);
    if (old) safeClose(old);
    return this.getStatus();
  }

  /**
   * One-off connection test: HELLO + LIN (+ AUTH when a token is given).
   * @returns {Promise<{version: string|null, protocol: number|null, group: string, admin: boolean, project: string|null, latencyMs: number, projectError?: string}>}
   */
  async test(target, password) {
    const opts = { ...this.options };
    const tmp = new ConnectionManager({ createClient: this.createClient, options: { ...opts, poolSize: 1, heartbeatMs: 0 }, logger: this.logger });
    let opened;
    let projectError;
    try {
      opened = await tmp._open(target, password, target.token);
    } catch (err) {
      if (!target.token || err.code === "AUTH" && /login/i.test(err.message)) throw err;
      if (err.code !== "AUTH" && err.code !== "NOPROJECT") throw err;
      projectError = err.message;
      opened = await tmp._open(target, password, undefined);
    }
    await safeClose(opened.client);
    return {
      version: opened.hello.version ?? null,
      protocol: opened.hello.protocol ?? null,
      group: opened.who.group,
      admin: opened.who.admin,
      project: opened.who.project,
      latencyMs: opened.latencyMs,
      ...(projectError ? { projectError } : {}),
    };
  }
}

async function safeClose(client) {
  try {
    if (client && typeof client.close === "function") {
      await Promise.race([client.close(), new Promise((r) => setTimeout(r, 1500).unref?.())]);
    }
  } catch {
    /* ignore */
  }
}

module.exports = { ConnectionManager, DEFAULT_OPTIONS };

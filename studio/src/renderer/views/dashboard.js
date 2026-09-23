/**
 * Dashboard: INFO polled every N seconds (Settings > refresh interval).
 */
import { h, replace } from "../util/dom.js";
import { pageHeader, card, badge, statList, button } from "../components/common.js";
import { Sparkline } from "../components/sparkline.js";
import { toastError } from "../components/toast.js";
import { formatBytes, formatNumber, formatPercent, formatDuration, formatDate, relativeTime, plural } from "../util/format.js";

function tile(label, valueEl, sub) {
  return h("div", { class: "tile" }, h("div", { class: "tile-label" }, label), h("div", { class: "tile-value" }, valueEl), sub ? h("div", { class: "tile-sub" }, sub) : null);
}

function meter(used, max, label) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const level = ratio > 0.9 ? "danger" : ratio > 0.75 ? "warn" : "ok";
  const fill = h("div", { class: ["meter-fill", `meter-${level}`], style: { width: `${(ratio * 100).toFixed(1)}%` } });
  return h(
    "div",
    { class: "meter", role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(max || 0), "aria-valuenow": String(used || 0), "aria-valuetext": max > 0 ? `${formatBytes(used)} of ${formatBytes(max)} (${formatPercent(ratio)})` : `${formatBytes(used)}, no limit` },
    fill,
  );
}

export default {
  id: "dashboard",
  title: "Dashboard",
  icon: "gauge",
  needs: "connection",
  mount(root, ctx) {
    const { api, store } = ctx;
    const opsSpark = new Sparkline({ label: "Operations per second", format: (v) => formatNumber(Math.round(v)), min: 0 });
    const memSpark = new Sparkline({ label: "Memory used", format: formatBytes, min: 0 });
    const tiles = h("div", { class: "tiles" });
    const details = h("div", { class: "dash-grid" });
    const updated = h("span", { class: "muted small", "aria-live": "off" });
    const pauseBtn = button("Pause", () => togglePause(), { small: true });
    let timer = null;
    let paused = false;
    let inflight = false;
    let last = null; // {commands, at}
    let stopped = false;

    root.append(
      pageHeader("Dashboard", "Server health from INFO.", updated, pauseBtn, button("Refresh", () => poll(), { small: true, iconName: "refresh" })),
      tiles,
      h("div", { class: "spark-row" }, card("Operations / s", opsSpark.el), card("Memory used", memSpark.el)),
      details,
    );

    function togglePause() {
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-pressed", String(paused));
      if (!paused) poll();
    }

    function schedule() {
      clearTimeout(timer);
      if (stopped || paused) return;
      timer = setTimeout(poll, store.get().settings.refreshMs || 2000);
    }

    async function poll() {
      if (inflight || stopped) return;
      if (store.get().status.state !== "connected") {
        schedule();
        return;
      }
      inflight = true;
      try {
        const info = await api.db.info();
        render(info);
        updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      } catch (err) {
        if (err.code !== "ECONN" && err.code !== "NOTCONNECTED") toastError(err, "INFO failed");
        updated.textContent = `Update failed (${err.code || "error"})`;
      } finally {
        inflight = false;
        schedule();
      }
    }

    function render(info) {
      const server = info.server || {};
      const clients = info.clients || {};
      const stats = info.stats || {};
      const memory = info.memory || {};
      const persistence = info.persistence || {};
      const keyspace = info.keyspace || {};
      const project = info.project || null;

      // ops/s: the server's figure, or our own delta of the command counter
      let ops = Number(stats.opsPerSecond);
      const now = Date.now();
      if (!Number.isFinite(ops) && last && stats.commands !== undefined) {
        ops = ((Number(stats.commands) - last.commands) * 1000) / Math.max(1, now - last.at);
      }
      if (stats.commands !== undefined) last = { commands: Number(stats.commands), at: now };
      opsSpark.push(Number.isFinite(ops) ? ops : 0);
      const used = Number(memory.usedBytes) || 0;
      const max = Number(memory.maxBytes) || 0;
      memSpark.push(used);

      const hits = Number(stats.hits) || 0;
      const misses = Number(stats.misses) || 0;
      const ratio = hits + misses > 0 ? hits / (hits + misses) : null;
      const healthy = persistence.healthy !== false;

      replace(
        tiles,
        tile("Ops / s", formatNumber(Math.round(ops || 0)), `${formatNumber(stats.commands)} commands total`),
        tile("Clients", formatNumber(clients.connected), `max ${formatNumber(clients.maxClients)}`),
        tile(
          "Memory",
          formatBytes(used),
          max > 0 ? h("div", {}, meter(used, max, "Memory used"), `of ${formatBytes(max)} (${memory.evictionPolicy || "?"})`) : "no max-memory limit",
        ),
        tile("Keys", formatNumber(keyspace.keys), `${formatNumber(keyspace.cacheKeys)} cache · ${formatNumber(keyspace.persistentKeys)} durable`),
        tile("Tables", formatNumber(keyspace.tables), plural(Number(keyspace.projects) || 0, "project")),
        tile("Hit ratio", formatPercent(ratio), `${formatNumber(hits)} hits · ${formatNumber(misses)} misses`),
        tile("Evictions", formatNumber(stats.evictions), `${formatNumber(stats.expired)} expired`),
        tile("Uptime", formatDuration(server.uptimeSeconds), `since ${formatDate(new Date(Date.now() - (server.uptimeSeconds || 0) * 1000).toISOString())}`),
      );

      replace(
        details,
        card(
          h("span", {}, "Persistence ", persistence.enabled === false ? badge("disabled", "muted") : healthy ? badge("healthy", "ok") : badge("unhealthy", "error")),
          statList([
            ["fsync mode", persistence.fsync ?? "–"],
            ["WAL size", formatBytes(persistence.walBytes)],
            ["WAL segment / records", `${formatNumber(persistence.walSegment)} / ${formatNumber(persistence.walRecords)}`],
            ["Queued writes", formatNumber(persistence.walQueued)],
            ["Last checkpoint", persistence.lastCheckpointAt ? `${relativeTime(persistence.lastCheckpointAt)} (${formatDate(persistence.lastCheckpointAt)})` : "never"],
            ["Checkpoints", formatNumber(persistence.checkpoints)],
            ["Snapshot size", formatBytes(persistence.snapshotBytes)],
            ["Changes since checkpoint", formatNumber(persistence.changesSinceCheckpoint)],
            ["Last error", persistence.lastError ? h("span", { class: "text-error" }, persistence.lastError) : "none"],
          ]),
        ),
        card(
          "Memory",
          statList([
            ["Data used", formatBytes(memory.usedBytes)],
            ["max-memory", max > 0 ? formatBytes(max) : "unlimited"],
            ["Eviction policy", memory.evictionPolicy ?? "–"],
            ["JVM heap", `${formatBytes(memory.heapUsedBytes)} of ${formatBytes(memory.heapMaxBytes)}`],
          ]),
          memory.heapMaxBytes ? meter(Number(memory.heapUsedBytes) || 0, Number(memory.heapMaxBytes) || 0, "JVM heap used") : null,
        ),
        card(
          "Traffic",
          statList([
            ["Commands", formatNumber(stats.commands)],
            ["Errors", formatNumber(stats.errors)],
            ["Bytes in / out", `${formatBytes(stats.bytesIn)} / ${formatBytes(stats.bytesOut)}`],
            ["Login failures", formatNumber(stats.loginFailures)],
            ["Busy rejections", formatNumber(stats.busyRejections)],
            ["Connections accepted / rejected", `${formatNumber(clients.accepted)} / ${formatNumber(clients.rejected)}`],
          ]),
        ),
        card(
          "Server",
          statList([
            ["Version", `${server.version ?? "–"} (protocol ${server.protocol ?? "?"})`],
            ["Java", server.java ?? "–"],
            ["OS", server.os ?? "–"],
            ["CPUs / IO / workers", `${server.cpus ?? "–"} / ${server.ioThreads ?? "–"} / ${server.workerThreads ?? "–"}`],
            ["PID", server.pid ?? "–"],
            ...(server.bind ? [["Bind", server.bind]] : []),
          ]),
        ),
        project
          ? card(
              "Current project",
              statList([
                ["Keys", formatNumber(project.keys)],
                ["Cache / durable", `${formatNumber(project.cacheKeys)} / ${formatNumber(project.persistentKeys)}`],
                ["Tables", formatNumber(project.tables)],
              ]),
            )
          : null,
        info.recovery
          ? card(
              "Last recovery (admin)",
              statList([
                ["Snapshot records", formatNumber(info.recovery.snapshotRecords)],
                ["WAL segments / records", `${formatNumber(info.recovery.walSegments)} / ${formatNumber(info.recovery.walRecords)}`],
                ["Truncated bytes", formatBytes(info.recovery.truncatedBytes)],
                ["Duration", `${formatNumber(info.recovery.millis)} ms`],
                ["Migrated 0.0.x data", info.recovery.migratedLegacy ? "yes" : "no"],
              ]),
            )
          : null,
      );
    }

    poll();

    return {
      refresh: poll,
      unmount() {
        stopped = true;
        clearTimeout(timer);
      },
      onStatus(status, prev) {
        if (status.state === "connected" && prev.state !== "connected") poll();
      },
    };
  },
};

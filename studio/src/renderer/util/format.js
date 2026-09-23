/**
 * Display formatting helpers (pure).
 */

export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "–";
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)} ${units[i]}`;
}

export function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "–";
  return v.toLocaleString("en-US");
}

export function formatPercent(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toFixed(ratio >= 0.9995 || ratio === 0 ? 0 : 1)}%`;
}

/** 93784 -> "1d 2h 3m" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** TTL seconds from the server: -1 none, -2 no cache value. */
export function formatTtl(ttl) {
  if (ttl === null || ttl === undefined || Number.isNaN(ttl)) return "–";
  if (ttl === -1) return "no TTL";
  if (ttl === -2) return "–";
  return formatDuration(ttl);
}

export function formatMs(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return "–";
  if (v < 1) return `${v.toFixed(2)} ms`;
  if (v < 1000) return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function formatDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const diff = Math.round((now - t) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function shortToken(token) {
  if (!token) return "–";
  const t = String(token);
  return t.length <= 14 ? t : `${t.slice(0, 8)}…${t.slice(-4)}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

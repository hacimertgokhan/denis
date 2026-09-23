export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function percent(used: number, max: number) {
  if (!max) return 0;
  return Math.min(100, Math.round((used / max) * 1000) / 10);
}

export function relativeTime(date: Date | string | null | undefined) {
  if (!date) return "never";
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

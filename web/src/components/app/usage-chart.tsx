"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatBytes, formatNumber } from "@/lib/format";

const PANEL = "rounded-lg border bg-card shadow-none gap-4 py-5";

export type UsagePoint = {
  hour: string;
  ops?: number;
  reads?: number;
  writes?: number;
  errors?: number;
  persistedBytes?: number;
  persistedKeys?: number;
  latencyMs?: number;
};

const opsConfig = {
  reads: { label: "Reads", color: "var(--chart-1)" },
  writes: { label: "Writes", color: "var(--chart-2)" },
  errors: { label: "Errors", color: "var(--chart-5)" },
} satisfies ChartConfig;

const storageConfig = {
  persistedBytes: { label: "Stored", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Fill the hourly series so the chart shows gaps as zero instead of interpolating over them. */
function fill(points: UsagePoint[], days: number): UsagePoint[] {
  const byHour = new Map(points.map((p) => [new Date(p.hour).toISOString(), p]));
  const out: UsagePoint[] = [];
  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  let lastBytes = 0;
  for (let t = end.getTime() - days * 24 * 3600 * 1000; t <= end.getTime(); t += 3600 * 1000) {
    const iso = new Date(t).toISOString();
    const p = byHour.get(iso);
    if (p?.persistedBytes) lastBytes = p.persistedBytes;
    out.push({
      hour: iso,
      ops: p?.ops ?? 0,
      reads: p?.reads ?? 0,
      writes: p?.writes ?? 0,
      errors: p?.errors ?? 0,
      persistedBytes: p?.persistedBytes ?? lastBytes,
    });
  }
  return out;
}

const tickFormatter = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });

export function OpsChart({ points, days = 7, title = "Commands", description }: { points: UsagePoint[]; days?: number; title?: string; description?: string }) {
  const data = fill(points, days);
  return (
    <Card className={PANEL}>
      <CardHeader>
        <CardTitle className="text-[15px] font-medium">{title}</CardTitle>
        <CardDescription className="text-[13px]">{description ?? `Reads, writes and errors per hour, last ${days} days`}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={opsConfig} className="aspect-auto h-64 w-full">
          <AreaChart data={data} margin={{ left: 0, right: 8 }}>
            <defs>
              {Object.entries(opsConfig).map(([key, cfg]) => (
                <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={cfg.color} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={cfg.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} minTickGap={48} tickFormatter={tickFormatter} />
            <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatNumber(v)} allowDecimals={false} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(v) => tickFormatter(String(v))} indicator="dot" />} />
            <Area dataKey="reads" type="monotone" stackId="a" stroke="var(--color-reads)" fill="url(#fill-reads)" />
            <Area dataKey="writes" type="monotone" stackId="a" stroke="var(--color-writes)" fill="url(#fill-writes)" />
            <Area dataKey="errors" type="monotone" stackId="b" stroke="var(--color-errors)" fill="url(#fill-errors)" />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function StorageChart({ points, days = 7, maxBytes }: { points: UsagePoint[]; days?: number; maxBytes?: number }) {
  const data = fill(points, days);
  return (
    <Card className={PANEL}>
      <CardHeader>
        <CardTitle className="text-[15px] font-medium">Storage</CardTitle>
        <CardDescription className="text-[13px]">
          Persisted data over time
          {maxBytes ? ` (limit ${formatBytes(maxBytes)})` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={storageConfig} className="aspect-auto h-56 w-full">
          <AreaChart data={data} margin={{ left: 0, right: 8 }}>
            <defs>
              <linearGradient id="fill-storage" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-persistedBytes)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="var(--color-persistedBytes)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} minTickGap={48} tickFormatter={tickFormatter} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatBytes(v)} domain={[0, maxBytes ?? "auto"]} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent labelFormatter={(v) => tickFormatter(String(v))} formatter={(value) => formatBytes(Number(value))} indicator="line" />
              }
            />
            <Area dataKey="persistedBytes" type="step" stroke="var(--color-persistedBytes)" fill="url(#fill-storage)" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@convex/_generated/api";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
import { LoadingState } from "@/components/LoadingState";

const INK = "#0b0d10";
const MUTE = "#5c6775";
const SIGNAL = "#8fd414";
const SIGNAL_SOFT = "#b8ff3c";
const MODEL_COLORS = ["#0b0d10", "#8fd414", "#3b82f6", "#8b5cf6", "#f59e0b"];
const OTHER_COLOR = "#c2c9d1";

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function shortModel(model: string): string {
  const tail = model.split("/").pop() || model;
  return tail.replace(/:free$/, "");
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) {
    return <span className="text-[11px] font-medium text-wire-mute">—</span>;
  }
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        up ? "text-[#4d7c0f]" : "text-[#dc2626]",
      )}
    >
      {up ? (
        <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
      ) : (
        <ArrowDownRight className="h-3 w-3" strokeWidth={2} />
      )}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const data = points.map((v, i) => ({ i, v }));
  return (
    <div className="h-9 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SIGNAL_SOFT} stopOpacity={0.7} />
              <stop offset="100%" stopColor={SIGNAL_SOFT} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={SIGNAL}
            strokeWidth={1.5}
            fill="url(#spark)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({
  label,
  value,
  current,
  previous,
  spark,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  spark: number[];
}) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-wire-mute">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[1.65rem] font-bold leading-none tracking-tight text-wire-ink">
            {value}
          </p>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-wire-mute">
            <Delta current={current} previous={previous} />
            <span>vs prev 30d</span>
          </p>
        </div>
        <Sparkline points={spark} />
      </div>
    </div>
  );
}

type TooltipEntry = {
  name?: string | number;
  value?: string | number;
  color?: string;
};

function ChartTooltip({
  active,
  label,
  payload,
  format,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  format: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[12px] shadow-[0_8px_28px_rgba(0,0,0,0.10)]">
      <p className="font-medium text-wire-ink">{label}</p>
      <div className="mt-1 space-y-0.5">
        {payload.map((p, i) => (
          <p key={i} className="flex items-center gap-1.5 text-wire-mute">
            <span
              className="h-2 w-2 rounded-[3px]"
              style={{ backgroundColor: p.color }}
            />
            <span className="max-w-[11rem] truncate">{p.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-wire-ink">
              {format(Number(p.value ?? 0))}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-wire-ink">{title}</h2>
        {subtitle ? (
          <span className="text-[11px] text-wire-mute">{subtitle}</span>
        ) : null}
      </div>
      <div className="mt-4 h-52">{children}</div>
    </section>
  );
}

const AXIS_TICK = { fontSize: 10, fill: MUTE } as const;

export function UsageView() {
  const { isAuthenticated } = useConvexAuth();
  const summary = useQuery(api.usage.summaryMine, isAuthenticated ? {} : "skip");

  const daily = useMemo(() => summary?.daily ?? [], [summary]);
  const topModels = useMemo(() => summary?.topModels ?? [], [summary]);

  const modelChartData = useMemo(() => {
    const top = topModels.map((m) => m.model);
    return daily.map((d) => {
      const row: Record<string, number | string> = { date: shortDate(d.date) };
      let other = 0;
      for (const [model, count] of Object.entries(d.byModel)) {
        if (top.includes(model)) {
          row[shortModel(model)] = ((row[shortModel(model)] as number) ?? 0) + count;
        } else {
          other += count;
        }
      }
      if (other > 0) row.Other = other;
      for (const m of top) {
        const k = shortModel(m);
        if (row[k] === undefined) row[k] = 0;
      }
      return row;
    });
  }, [daily, topModels]);

  const spendData = useMemo(
    () => daily.map((d) => ({ date: shortDate(d.date), spend: d.costUsd })),
    [daily],
  );
  const tokenData = useMemo(
    () =>
      daily.map((d) => ({
        date: shortDate(d.date),
        Prompt: d.promptTokens,
        Completion: d.completionTokens,
      })),
    [daily],
  );

  if (summary === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-wire-mute">
        Sign in to see usage.
      </div>
    );
  }

  const { chat, graph, map, activity, period } = summary;
  const cur = period.current;
  const prev = period.previous;

  const sparkOf = (pick: (d: (typeof daily)[number]) => number) =>
    daily.map((d) => pick(d));

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-wire-mute">
            Usage
          </p>
          <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-wire-ink">
            Activity
          </h1>
        </div>
        <p className="text-[12px] text-wire-mute">Last 30 days · all times local</p>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total spend"
          value={formatUsd(cur.costUsd)}
          current={cur.costUsd}
          previous={prev.costUsd}
          spark={sparkOf((d) => d.costUsd)}
        />
        <StatCard
          label="Requests"
          value={cur.requests.toLocaleString()}
          current={cur.requests}
          previous={prev.requests}
          spark={sparkOf((d) => d.requests)}
        />
        <StatCard
          label="Token volume"
          value={formatTokens(cur.tokens)}
          current={cur.tokens}
          previous={prev.tokens}
          spark={sparkOf((d) => d.totalTokens)}
        />
        <StatCard
          label="Graph builds"
          value={cur.builds.toLocaleString()}
          current={cur.builds}
          previous={prev.builds}
          spark={sparkOf((d) => d.graphBuilds)}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Spend over time" subtitle="USD / day">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spendData} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SIGNAL_SOFT} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={SIGNAL_SOFT} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(11,13,16,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={54}
                tickFormatter={(v: number) => (v > 0 ? `$${v.toFixed(2)}` : "$0")}
              />
              <Tooltip
                content={<ChartTooltip format={(v) => formatUsd(v)} />}
                cursor={{ stroke: "rgba(11,13,16,0.15)" }}
              />
              <Area
                type="monotone"
                dataKey="spend"
                name="Spend"
                stroke={SIGNAL}
                strokeWidth={1.75}
                fill="url(#spend-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Requests by model" subtitle="chat replies / day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={modelChartData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(11,13,16,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                content={
                  <ChartTooltip format={(v) => `${v.toLocaleString()} req`} />
                }
                cursor={{ fill: "rgba(11,13,16,0.03)" }}
              />
              {topModels.map((m, i) => (
                <Bar
                  key={m.model}
                  dataKey={shortModel(m.model)}
                  stackId="models"
                  fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                  radius={i === topModels.length - 1 ? [3, 3, 0, 0] : 0}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
              ))}
              <Bar
                dataKey="Other"
                stackId="models"
                fill={OTHER_COLOR}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Token breakdown" subtitle="prompt vs completion / day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tokenData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="rgba(11,13,16,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => formatTokens(v)}
              />
              <Tooltip
                content={<ChartTooltip format={(v) => `${formatTokens(v)} tok`} />}
                cursor={{ fill: "rgba(11,13,16,0.03)" }}
              />
              <Bar
                dataKey="Prompt"
                stackId="tokens"
                fill={INK}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Bar
                dataKey="Completion"
                stackId="tokens"
                fill={SIGNAL}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-wire-ink">Totals</h2>
            <span className="text-[11px] text-wire-mute">all time</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Chat replies</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{chat.count.toLocaleString()}</dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Chat tokens</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{formatTokens(chat.totalTokens)}</dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Chat spend</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{formatUsd(chat.costUsd)}</dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Graph builds</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{graph.builds.toLocaleString()}</dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Nodes processed</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatTokens(graph.nodesProcessed)}
              </dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Map generations</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {(map?.count ?? 0).toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Map tokens</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatTokens(map?.totalTokens ?? 0)}
              </dd>
            </div>
            <div className="rounded-xl bg-[#fafafa] px-3 py-2.5">
              <dt className="text-[11px] text-wire-mute">Map spend</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {formatUsd(map?.costUsd ?? 0)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="mt-4 pb-8">
        <ActivityHeatmap
          days={activity.days}
          activeDays={activity.activeDays}
          totalActions={activity.totalActions}
        />
      </div>

    </div>
  );
}

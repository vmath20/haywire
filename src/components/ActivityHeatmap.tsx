"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

export type ActivityDay = {
  date: string;
  count: number;
  chat: number;
  graph: number;
};

/** Haywire signal greens — GitHub-style intensity steps. */
const LEVELS = [
  "bg-[#ebedf0]",
  "bg-[#e4f7b0]",
  "bg-[#c9f06a]",
  "bg-wire-signal",
  "bg-wire-signalDeep",
] as const;

function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 3;
  const t = count / max;
  if (t <= 0.25) return 1;
  if (t <= 0.5) return 2;
  if (t <= 0.75) return 3;
  return 4;
}

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];

export function ActivityHeatmap({
  days,
  activeDays,
  totalActions,
}: {
  days: ActivityDay[];
  activeDays: number;
  totalActions: number;
}) {
  const [hover, setHover] = useState<ActivityDay | null>(null);

  const { weeks, monthLabels, maxCount } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const today = startOfDay(new Date());
    // End on today; start ~52 weeks earlier on Sunday (GitHub style).
    const end = today;
    const start = new Date(end);
    start.setDate(start.getDate() - 52 * 7);
    // Align start to Sunday
    start.setDate(start.getDate() - start.getDay());

    const weeks: (ActivityDay & { empty?: boolean })[][] = [];
    const cursor = new Date(start);
    let week: (ActivityDay & { empty?: boolean })[] = [];

    while (cursor <= end || week.length > 0) {
      if (cursor > end && week.length === 0) break;
      if (cursor > end) {
        while (week.length < 7) {
          week.push({ date: "", count: 0, chat: 0, graph: 0, empty: true });
        }
        weeks.push(week);
        break;
      }
      const key = toKey(cursor);
      const found = byDate.get(key);
      week.push(
        found ?? {
          date: key,
          count: 0,
          chat: 0,
          graph: 0,
        },
      );
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    weeks.forEach((w, wi) => {
      const first = w.find((d) => !d.empty && d.date);
      if (!first) return;
      const dt = parseLocalDate(first.date);
      const m = dt.getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ label: MONTHS[m]!, weekIndex: wi });
        lastMonth = m;
      }
    });

    const maxCount = Math.max(1, ...days.map((d) => d.count));
    return { weeks, monthLabels, maxCount };
  }, [days]);

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-wire-mute">
            Activity
          </h2>
          <p className="mt-2 text-sm text-wire-ink">
            <span className="font-semibold">{totalActions.toLocaleString()}</span>
            <span className="text-wire-mute"> actions in the last year · </span>
            <span className="font-semibold">{activeDays}</span>
            <span className="text-wire-mute"> active days</span>
          </p>
        </div>
        {hover && hover.date ? (
          <p className="rounded-lg bg-[#0b0d10] px-2.5 py-1.5 text-[11px] font-medium text-white">
            {hover.count} action{hover.count === 1 ? "" : "s"} on{" "}
            {parseLocalDate(hover.date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {hover.count > 0
              ? ` · ${hover.chat} chat · ${hover.graph} graph`
              : ""}
          </p>
        ) : (
          <p className="text-[11px] text-wire-mute">Hover a day for detail</p>
        )}
      </div>

      <div className="mt-5 overflow-x-auto pb-1">
        <div className="inline-block min-w-[720px]">
          {/* Month labels */}
          <div className="relative mb-1.5 ml-8 h-4">
            {monthLabels.map((m) => (
              <span
                key={`${m.label}-${m.weekIndex}`}
                className="absolute text-[10px] font-medium text-wire-mute"
                style={{ left: `${m.weekIndex * 13}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="flex gap-1">
            {/* Weekday labels */}
            <div className="flex w-7 flex-col gap-[3px] pt-0">
              {WEEKDAYS.map((label, i) => (
                <div
                  key={i}
                  className="flex h-[11px] items-center text-[9px] leading-none text-wire-mute"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((day, di) => {
                    if (day.empty || !day.date) {
                      return <div key={di} className="h-[11px] w-[11px]" />;
                    }
                    const level = levelFor(day.count, maxCount);
                    return (
                      <button
                        key={day.date}
                        type="button"
                        title={`${day.count} on ${day.date}`}
                        onMouseEnter={() => setHover(day)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(day)}
                        onBlur={() => setHover(null)}
                        className={clsx(
                          "h-[11px] w-[11px] rounded-[2px] outline-none ring-wire-ink/30 transition hover:ring-1 focus:ring-1",
                          LEVELS[level],
                          level === 0 && "border border-black/[0.04]",
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-wire-mute">
            <span>Less</span>
            {LEVELS.map((c, i) => (
              <span
                key={c}
                className={clsx(
                  "h-[11px] w-[11px] rounded-[2px]",
                  c,
                  i === 0 && "border border-black/[0.04]",
                )}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </section>
  );
}

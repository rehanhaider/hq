import { barY, crosshair, defineChart, lineY } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { activityValues, type dailyActivity } from "./activity";
import type { Filters } from "./model";

export const metricLabels = {
  commits: "Commits",
  prs: "PRs merged",
  lines: "LOCs",
};

export type ActivityRow = ReturnType<typeof dailyActivity>[number] & {
  value: number | null;
};

export function monthName(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

export function activityReadout(row: ActivityRow, metric: Filters["metric"]) {
  return `${row.day}: ${row.value === null ? "Not imported" : `${row.value.toLocaleString()} ${metricLabels[metric]}`} · ${row.coverage} coverage`;
}

/** Day-of-month ticks: every day for short ranges, about eight otherwise. */
export function dayTicks(days: string[]) {
  if (days.length <= 12) return days;
  const step = Math.ceil(days.length / 8);
  const tail = days.length - Math.ceil(days.length / 16);
  return days.filter(
    (_, i) => (i % step === 0 && i < tail) || i === days.length - 1,
  );
}

/** The first day shown of each month. */
export function monthStarts(days: string[]) {
  return days.filter((day, i) => i === 0 || day.slice(5, 7) !== days[i - 1]!.slice(5, 7));
}

export function activityChart(
  rows: ReturnType<typeof dailyActivity>,
  metric: Filters["metric"],
  chart: Filters["chart"],
) {
  const values = activityValues(rows, metric, chart);
  const data: ActivityRow[] = rows.map((row, i) => ({ ...row, value: values[i]! }));
  const days = data.map((row) => row.day);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const shown = data.filter((row) => row.value !== null);
  const bars = (coverage: string, fillOpacity: number) =>
    barY(
      shown.filter((row) => row.coverage === coverage),
      { x: "day", y: "value", key: "day", fill: "var(--primary)", fillOpacity, maxThickness: 60 },
    );
  return defineChart({
    marks: [
      crosshair({ x: { band: { fill: "var(--foreground)", fillOpacity: 0.06 } }, y: false }),
      // Every day, imported or not, gets a full-height target, so pointer and
      // keyboard reach the days that have no bar or point of their own.
      barY(data, { x: "day", y1: 0, y2: max, key: "day", fill: "transparent" }),
      ...(chart === "daily"
        ? [bars("complete", 0.85), bars("partial", 0.55)]
        : [
            lineY(data, {
              x: "day",
              y: "value",
              key: "day",
              stroke: "var(--primary)",
              strokeWidth: 3,
              points: data.length <= 90,
            }),
          ]),
    ],
    scales: {
      x: {
        scale: scaleBand<string>().domain(days).padding(0.15),
        axis: {
          line: false,
          ticks: { values: dayTicks(days), size: 0, format: (day: string) => day.slice(8) },
          tickLabels: { thin: false },
        },
      },
      month: {
        channel: "x",
        scale: scaleBand<string>().domain(days),
        axis: {
          line: false,
          ticks: { values: monthStarts(days), size: 0, format: monthName },
          tickLabels: {
            thin: false,
            fontWeight: 500,
            anchor: "start",
            dx: ({ bandwidth }) => -bandwidth / 2,
          },
        },
      },
      y: {
        scale: scaleLinear().domain([0, max]),
        grid: { stroke: "var(--border)", strokeOpacity: 1 },
        axis: {
          line: false,
          ticks: {
            values: [0, max / 2, max],
            size: 0,
            format: (v: number) => Math.round(v).toLocaleString(),
          },
        },
      },
    },
    focus: "group-x",
    focusRing: false,
    maxFocusDistance: Number.POSITIVE_INFINITY,
    tooltip: {
      use: tooltip,
      sticky: false,
      formatGroup: (points) =>
        points[0] ? activityReadout(points[0].datum, metric) : "",
    },
  });
}

export type Slice = { name: string; value: number; color: string };

/** A donut over named shares. The center readout is left to the caller. */
export function donutChart(
  slices: Slice[],
  {
    hole,
    format,
  }: { hole: number; format?: (slice: Slice) => string },
) {
  return defineChart({
    marks: [
      polar({
        scales: { angle: null, radius: null },
        marks: [
          radialArc(pie(slices, { value: "value" }), {
            innerRadius: ({ radius }) => radius * hole,
            key: "name",
            fill: (slice) => slice.color,
          }),
        ],
      }),
    ],
    scales: { x: null, y: null },
    focusRing: false,
    ...(format
      ? {
          tooltip: {
            use: tooltip,
            sticky: false,
            format: (point: { datum: Slice }) => format(point.datum),
          },
        }
      : { keyboard: false }),
  });
}

export type WeekDay = { day: string; prs: number };

export function weekChart(
  days: WeekDay[],
  {
    label,
    tick,
  }: { label: (entry: WeekDay) => string; tick: (day: string) => string },
) {
  const peak = Math.max(...days.map((entry) => entry.prs), 0);
  return defineChart({
    marks: [
      barY(days, {
        x: "day",
        // A sliver keeps each empty day visible next to a busy one.
        y: (entry) => (peak > 0 ? Math.max(entry.prs, peak * 0.02) : 0),
        key: "day",
        fill: "var(--primary)",
        fillOpacity: 0.85,
        radius: { end: 3 },
      }),
    ],
    scales: {
      x: {
        scale: scaleBand<string>().domain(days.map((entry) => entry.day)).padding(0.12),
        axis: {
          line: { stroke: "var(--border)", strokeOpacity: 1 },
          ticks: { size: 0, format: tick },
          tickLabels: { thin: false },
        },
      },
      y: { scale: scaleLinear().domain([0, Math.max(peak, 1)]), axis: false },
    },
    margin: { top: 0, right: 0, left: 0 },
    focusRing: false,
    tooltip: {
      use: tooltip,
      sticky: false,
      format: (point) => label(point.datum),
    },
  });
}

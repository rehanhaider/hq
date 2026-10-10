import { createChartScene } from "@tanstack/charts";
import { renderChartSvg } from "@tanstack/charts/svg";
import { expect, it } from "vitest";
import { dailyActivity } from "./activity";
import {
  activityChart,
  activityReadout,
  dayTicks,
  donutChart,
  monthStarts,
  weekChart,
} from "./charts";

const size = { width: 900, height: 240 };
const rows = dailyActivity(
  [
    { day: "2026-01-30", commits: 2, prs: 1, additions: 8, deletions: 2 },
    { day: "2026-02-01", commits: 3, prs: 0, additions: 1, deletions: 0 },
  ],
  "2026-01-29",
  "2026-02-02",
  [
    { since: "2026-01-30T00:00:00.000Z", until: "2026-02-01T12:00:00.000Z" },
  ],
);

it("labels day ticks and the first day of each month", () => {
  const days = rows.map((row) => row.day);
  expect(dayTicks(days)).toEqual(days);
  expect(monthStarts(days)).toEqual(["2026-01-29", "2026-02-01"]);
  const long = Array.from({ length: 90 }, (_, i) => `d${i}`);
  expect(dayTicks(long)).toEqual(["d0", "d12", "d24", "d36", "d48", "d60", "d72", "d89"]);
});

it("gives every day, imported or not, one keyboard and pointer target", () => {
  for (const mode of ["daily", "cumulative"] as const) {
    const scene = createChartScene(activityChart(rows, "commits", mode), size);
    const days = new Set(scene.points.map((point) => point.datum.day));
    expect([...days]).toEqual(rows.map((row) => row.day));
  }
});

it("draws partial days fainter than complete days and skips missing ones", () => {
  const svg = renderChartSvg(
    createChartScene(activityChart(rows, "commits", "daily"), size),
    { ariaLabel: "Commits" },
  );
  expect(svg.match(/fill-opacity="0.85"/g)).toHaveLength(2);
  expect(svg.match(/fill-opacity="0.55"/g)).toHaveLength(1);
});

it("reads out values, missing history, and coverage", () => {
  const scene = createChartScene(activityChart(rows, "commits", "cumulative"), size);
  const readouts = [...new Map(scene.points.map((p) => [p.datum.day, p.datum])).values()]
    .map((row) => activityReadout(row, "commits"));
  expect(readouts).toEqual([
    "2026-01-29: Not imported · none coverage",
    "2026-01-30: 2 Commits · complete coverage",
    "2026-01-31: 2 Commits · complete coverage",
    "2026-02-01: 5 Commits · partial coverage",
    "2026-02-02: Not imported · none coverage",
  ]);
});

it("draws one slice per share in its own color", () => {
  const slices = [
    { name: "TypeScript", value: 3, color: "var(--chart-1)" },
    { name: "Other", value: 1, color: "var(--chart-6)" },
  ];
  const scene = createChartScene(donutChart(slices, { hole: 0.56 }), { width: 200, height: 200 });
  expect(scene.points.map((point) => point.datum.name)).toEqual(["TypeScript", "Other"]);
  const svg = renderChartSvg(scene, { ariaLabel: "Languages" });
  expect(svg).toContain("var(--chart-1)");
  expect(svg).toContain("var(--chart-6)");
});

it("keeps a sliver for empty days only when the week has a peak", () => {
  const busy = createChartScene(
    weekChart([{ day: "2026-10-05", prs: 0 }, { day: "2026-10-06", prs: 4 }], { label: () => "", tick: (day) => day }),
    { width: 200, height: 100 },
  );
  expect(busy.points.map((point) => point.yValue)).toEqual([0.08, 4]);
  const quiet = createChartScene(
    weekChart([{ day: "2026-10-05", prs: 0 }], { label: () => "", tick: (day) => day }),
    { width: 200, height: 100 },
  );
  expect(quiet.points.map((point) => point.yValue)).toEqual([0]);
});

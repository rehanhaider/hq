import { expect, it } from "vitest";
import { activityValues, dailyActivity, monthsBefore } from "./activity";
import { languageOf } from "./languages";
it("clamps calendar presets across leap days and years", () => {
  expect(monthsBefore("2024-03-31", 1)).toBe("2024-02-29");
  expect(monthsBefore("2024-02-29", 12)).toBe("2023-02-28");
  expect(monthsBefore("2026-09-07", 72)).toBe("2020-09-07");
});
it("pads days but distinguishes missing history, includes merged-by-only PRs, and accumulates selected dates", () => {
  const rows = dailyActivity(
    [
      {
        day: "2026-01-31",
        commits: 2,
        prs: 1,
        mergedPrs: 3,
        additions: 8,
        deletions: 2,
      },
      {
        day: "2026-02-02",
        commits: 1,
        prs: 0,
        mergedPrs: 2,
        additions: 4,
        deletions: 1,
      },
    ],
    "2026-01-30",
    "2026-02-02",
    [{ since: "2026-01-31T00:00:00.000Z", until: "2026-02-02T12:00:00.000Z" }],
  );
  expect(rows.map((r) => r.coverage)).toEqual([
    "none",
    "complete",
    "complete",
    "partial",
  ]);
  expect(activityValues(rows, "commits", "daily")).toEqual([null, 2, 0, 1]);
  expect(activityValues(rows, "mergedPrs", "cumulative")).toEqual([
    null,
    3,
    3,
    5,
  ]);
  expect(activityValues(rows, "lines", "cumulative")).toEqual([
    null,
    10,
    10,
    15,
  ]);
  expect(rows[0]?.from).toBe("2026-01-30");
  expect(rows[3]?.to).toBe("2026-02-02");
});
it("classifies changed files independently from project primary language", () => {
  expect(languageOf("src/app.test.tsx")).toBe("TypeScript");
  expect(languageOf("api/main.py")).toBe("Python");
  expect(languageOf("pnpm-lock.yaml")).toBe("Lockfiles");
  expect(languageOf("image.png")).toBe("Other / unknown");
  expect(languageOf("constructor")).toBe("Other / unknown");
});

import { describe, expect, it } from "vitest";
import { categorize, dailySeries, summarize, groupLanguages } from "./metrics";
import { daySchema, importSchema, searchSchema } from "./model";
import type { Dataset, Snapshot } from "./model";

const snapshot: Snapshot = {
  repo: {
    id: 1,
    fullName: "me/app",
    private: true,
    language: "TypeScript",
    defaultBranch: "main",
    pushedAt: null,
  },
  since: "2026-08-01T00:00:00.000Z",
  until: "2026-08-31T23:59:59.999Z",
  importedAt: "2026-09-01T00:00:00.000Z",
  commits: [
    {
      languages: { TypeScript: { additions: 100, deletions: 20 } },
      sha: "a",
      title: "Feature",
      url: "https://github.com/me/app/commit/a",
      date: "2026-08-12T00:00:00.000Z",
      merge: false,
      additions: 100,
      deletions: 20,
      categories: {
        Code: { additions: 80, deletions: 20 },
        Tests: { additions: 20, deletions: 0 },
      },
    },
    {
      sha: "b",
      title: "Merge",
      url: "https://github.com/me/app/commit/b",
      date: "2026-08-12T23:59:59.000Z",
      merge: true,
      additions: 100,
      deletions: 20,
      categories: { Code: { additions: 100, deletions: 20 } },
    },
    {
      sha: "c",
      title: "Next day",
      url: "https://github.com/me/app/commit/c",
      date: "2026-08-13T00:00:00.000Z",
      merge: false,
      additions: 50,
      deletions: 5,
      categories: { Documentation: { additions: 50, deletions: 5 } },
    },
  ],
  prs: [
    {
      number: 1,
      title: "My PR",
      url: "https://github.com/me/app/pull/1",
      author: "ME",
      mergedBy: "me",
      createdAt: "2026-08-11T00:00:00.000Z",
      mergedAt: "2026-08-12T00:00:00.000Z",
      additions: 500,
      deletions: 100,
    },
    {
      number: 2,
      title: "Colleague PR",
      url: "https://github.com/me/app/pull/2",
      author: "other",
      mergedBy: "me",
      createdAt: "2026-08-10T00:00:00.000Z",
      mergedAt: "2026-08-12T00:00:00.000Z",
      additions: 200,
      deletions: 100,
    },
  ],
};
const data: Dataset = {
  login: "me",
  snapshots: [snapshot],
  status: {
    state: "idle",
    completed: 0,
    total: 0,
    message: "",
    startedAt: null,
    finishedAt: null,
  },
};
const filters = searchSchema.parse({ from: "2026-08-12", to: "2026-08-12" });
describe("activity accounting", () => {
  it("includes both ends of the UTC day, excludes merge lines, and never adds PR lines to commit totals", () => {
    const result = summarize(data, filters);
    expect(result.total).toEqual({
      commits: 2,
      additions: 100,
      deletions: 20,
      authoredPrs: 1,
    });
    expect(result.breakdown.Code).toEqual({ additions: 80, deletions: 20 });
    expect(result.languages).toEqual([
      {
        name: "TypeScript",
        additions: 100,
        deletions: 20,
        commits: 1,
        projects: 1,
      },
    ]);
    expect(result.daily[0]?.prs).toBe(1);
    expect(result.activeDays).toBe(1);
    expect(result.medianHours).toBe(24);
    expect(result.history).toHaveLength(3);
    expect(result.incomplete).toEqual([]);
  });
  it("filters repositories without leaking their counts into charts or history", () => {
    const result = summarize(data, { ...filters, repo: "me/other" });
    expect(result.total.commits).toBe(0);
    expect(result.daily).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.medianHours).toBeNull();
  });
  it("reports incomplete coverage and retains zero-activity projects", () => {
    const result = summarize(data, {
      ...filters,
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(result.incomplete).toEqual(["me/app"]);
    expect(result.projects).toHaveLength(1);
    expect(result.total.commits).toBe(0);
  });
  it("does not count merging another author's PR as an authored active day", () => {
    const result = summarize(
      {
        ...data,
        snapshots: [{ ...snapshot, commits: [], prs: [snapshot.prs[1]!] }],
      },
      filters,
    );
    expect(result.activeDays).toBe(0);
    expect(result.total.authoredPrs).toBe(0);
    expect(result.history).toEqual([]);
    expect(result.daily).toEqual([]);
  });
});
describe("file categories", () => {
  it.each([
    ["src/app.tsx", "Code"],
    ["src/app.test.tsx", "Tests"],
    ["tests/auth.py", "Tests"],
    ["README.md", "Documentation"],
    ["docs/design.md", "Documentation"],
    [".github/workflows/ci.yml", "Configuration"],
    ["pnpm-lock.yaml", "Generated / dependencies"],
    ["vendor/test/foo.py", "Generated / dependencies"],
    ["public/logo.png", "Other"],
  ])("%s is %s", (path, category) => expect(categorize(path)).toBe(category));
});
describe("boundary validation", () => {
  it("rejects impossible dates and repository paths", () => {
    expect(daySchema.safeParse("2026-02-30").success).toBe(false);
    expect(
      importSchema.safeParse({
        since: "2026-08-01",
        repositories: ["owner/repo?admin=true"],
      }).success,
    ).toBe(false);
    expect(
      importSchema.safeParse({ since: "2026-08-01", repositories: [] }).success,
    ).toBe(false);
    expect(searchSchema.parse({ page: -1, view: "bad" }).page).toBe(1);
  });
});

it("counts authored PRs regardless of who merged them", () => {
  const result = summarize(
    {
      ...data,
      snapshots: [
        {
          ...snapshot,
          prs: [{ ...snapshot.prs[0]!, mergedBy: "other" }, snapshot.prs[1]!],
        },
      ],
    },
    filters,
  );
  expect(result.total.authoredPrs).toBe(1);
  expect(result.daily[0]?.prs).toBe(1);
  expect(
    result.history.filter((row) => row.kind === "pr").map((row) => row.title),
  ).toEqual(["My PR"]);
});

it("filters combinations of repositories across organizations and allows none", () => {
  const snapshots = ["me/app", "team/api", "team/web"].map(
    (fullName, index) => ({
      ...snapshot,
      repo: { ...snapshot.repo, id: index + 1, fullName },
    }),
  );
  const result = summarize(
    { ...data, snapshots },
    { ...filters, repo: ["me/app", "team/api"] },
  );
  expect(result.projects.map((row) => row.fullName)).toEqual([
    "me/app",
    "team/api",
  ]);
  expect(result.total.commits).toBe(4);
  expect(result.daily[0]?.commits).toBe(4);
  expect(result.languages[0]?.additions).toBe(200);
  expect(new Set(result.history.map((row) => row.repo))).toEqual(
    new Set(["me/app", "team/api"]),
  );
  expect(
    summarize({ ...data, snapshots }, { ...filters, repo: [] }).history,
  ).toEqual([]);
});

it("groups shares at or below one percent exactly once and last in both language views", () => {
  const rows = [970, 11, 10, 9, 0].map((additions, index) => ({
    name: String(index),
    additions,
    deletions: 0,
    commits: 1,
    projects: 1,
  }));
  const grouped = groupLanguages(rows);
  expect(grouped.map((row) => row.name)).toEqual([
    "0",
    "1",
    "Remaining 2 file types",
  ]);
  expect(grouped.at(-1)?.additions).toBe(19);
  expect(grouped.reduce((sum, row) => sum + row.additions, 0)).toBe(1000);
  expect(groupLanguages([])).toEqual([]);
});

describe("dailySeries", () => {
  const daily = [
    { day: "2026-09-09", commits: 3, prs: 1, additions: 10, deletions: 2 },
    { day: "2026-09-11", commits: 5, prs: 0, additions: 20, deletions: 4 },
  ];

  it("zero-fills every day of the range, in order", () => {
    const series = dailySeries(daily, "2026-09-08", "2026-09-12");
    expect(series.map((entry) => entry.day)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
    expect(series.map((entry) => entry.commits)).toEqual([0, 3, 0, 5, 0]);
  });

  it("returns one entry for a single day, and none for a reversed range", () => {
    expect(dailySeries(daily, "2026-09-09", "2026-09-09")).toEqual([daily[0]]);
    expect(dailySeries(daily, "2026-09-12", "2026-09-08")).toEqual([]);
  });

  it("ignores days outside the range", () => {
    const series = dailySeries(daily, "2026-09-10", "2026-09-11");
    expect(series).toHaveLength(2);
    expect(series.map((entry) => entry.commits)).toEqual([0, 5]);
  });
});

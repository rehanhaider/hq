import { describe, expect, it } from "vitest";
import {
  age,
  buildOpenWork,
  countWork,
  dedupe,
  normalise,
  normaliseAll,
  repoOf,
  sweepQueries,
  arrangeWork,
  repoOptions,
  tabItems,
  searchResponseSchema,
} from "./openWork";
import type { SearchItem, WorkItem } from "./openWork";

function raw(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id: 1,
    number: 7,
    title: "Fix the importer",
    html_url: "https://github.com/me/app/issues/7",
    repository_url: "https://api.github.com/repos/me/app",
    user: { login: "someone" },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: [],
    ...overrides,
  };
}
function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 1,
    kind: "issue",
    repo: "me/app",
    number: 7,
    title: "Fix the importer",
    url: "https://github.com/me/app/issues/7",
    author: "someone",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
    labels: [],
    draft: false,
    assignedToMe: false,
    ...overrides,
  };
}

describe("normalise", () => {
  it("reads the repository out of the API url", () => {
    expect(repoOf("https://api.github.com/repos/acme/widget")).toBe("acme/widget");
  });
  it("calls a result with a pull_request a pull request", () => {
    expect(normalise(raw({ pull_request: { url: "x" }, draft: true }), "me").kind).toBe("pr");
    expect(normalise(raw(), "me").kind).toBe("issue");
    expect(normalise(raw({ pull_request: { url: "x" }, draft: true }), "me").draft).toBe(true);
  });
  it("marks the rows assigned to me, whatever the case of the login", () => {
    expect(normalise(raw({ assignees: [{ login: "Me" }] }), "me").assignedToMe).toBe(true);
    expect(normalise(raw({ assignee: { login: "me" } }), "me").assignedToMe).toBe(true);
    expect(normalise(raw({ assignees: [{ login: "other" }] }), "me").assignedToMe).toBe(false);
  });
  it("keeps labels with their colour and survives a missing author", () => {
    const row = normalise(raw({ user: null }), "me");
    expect(row.author).toBe("unknown");
    expect(row.labels).toEqual([{ name: "bug", color: "d73a4a" }]);
  });
  it("parses a search response", () => {
    const parsed = searchResponseSchema.parse({ total_count: 1, items: [raw()] });
    expect(normaliseAll(parsed.items, "me")).toHaveLength(1);
  });
});

describe("dedupe", () => {
  it("keeps one row per id and carries an assignment across searches", () => {
    const rows = dedupe([
      item({ id: 1 }),
      item({ id: 1, assignedToMe: true }),
      item({ id: 2 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.assignedToMe).toBe(true);
  });
});

describe("counts", () => {
  it("counts open pull requests and issues apart", () => {
    const counts = countWork(
      [item({ id: 1 }), item({ id: 2, kind: "pr" }), item({ id: 3, kind: "pr" })],
      [item({ id: 1 })],
      [item({ id: 2, kind: "pr" }), item({ id: 3, kind: "pr" })],
    );
    expect(counts).toEqual({
      assigned: 1,
      reviewRequested: 2,
      openPrs: 2,
      openIssues: 1,
    });
  });
});

describe("buildOpenWork", () => {
  const work = buildOpenWork(
    {
      assigned: [item({ id: 1, assignedToMe: true, updatedAt: "2026-09-09T00:00:00Z" })],
      reviewRequested: [item({ id: 2, kind: "pr", updatedAt: "2026-09-02T00:00:00Z" })],
      authored: [item({ id: 3, kind: "pr", updatedAt: "2026-09-07T00:00:00Z" })],
      everything: [
        item({ id: 1, updatedAt: "2026-09-09T00:00:00Z" }),
        item({ id: 4, updatedAt: "2026-09-01T00:00:00Z" }),
      ],
    },
    "2026-09-10T00:00:00Z",
  );
  it("folds the personal searches into the full list without duplicates", () => {
    expect(work.all.map((row) => row.id)).toEqual([4, 2, 3, 1]);
  });
  it("keeps the assignment on the folded row", () => {
    expect(work.all.find((row) => row.id === 1)?.assignedToMe).toBe(true);
  });
  it("sorts the full list oldest updated first and counts it", () => {
    expect(work.counts).toEqual({
      assigned: 1,
      reviewRequested: 1,
      openPrs: 2,
      openIssues: 2,
    });
    expect(work.error).toBeUndefined();
    expect(work.connected).toBe(true);
  });
  it("keeps an error string when one is given", () => {
    const failed = buildOpenWork(
      { assigned: [], reviewRequested: [], authored: [], everything: [] },
      "2026-09-10T00:00:00Z",
      "GitHub request limit reached.",
    );
    expect(failed.error).toBe("GitHub request limit reached.");
  });
});

describe("sweepQueries", () => {
  it("ORs the owners into one query rather than repeating a qualifier", () => {
    const { queries, skipped } = sweepQueries("me", ["acme", "widgets"], []);
    expect(queries).toEqual(["is:open (user:me OR org:acme OR org:widgets)"]);
    expect(skipped).toBe(0);
  });
  it("splits a long list of owners across queries", () => {
    const orgs = ["a", "b", "c", "d", "e", "f"];
    expect(sweepQueries("me", orgs, []).queries).toHaveLength(2);
  });
  it("names collaborator repositories and says what it left out", () => {
    const repos = Array.from({ length: 27 }, (_, n) => `them/r${n}`);
    const { queries, skipped } = sweepQueries("me", [], repos);
    expect(queries).toHaveLength(5);
    expect(queries[1]).toContain("repo:them/r0 OR repo:them/r1");
    expect(skipped).toBe(3);
  });
});

describe("age", () => {
  const now = Date.parse("2026-09-10T00:00:00Z");
  it("counts up through the units", () => {
    expect(age("2026-09-09T23:59:48Z", now)).toBe("12s");
    expect(age("2026-09-09T23:30:00Z", now)).toBe("30m");
    expect(age("2026-09-09T01:00:00Z", now)).toBe("23h");
    expect(age("2026-09-07T00:00:00Z", now)).toBe("3d");
    expect(age("2026-06-10T00:00:00Z", now)).toBe("13w");
    expect(age("2024-09-10T00:00:00Z", now)).toBe("2y");
  });
  it("says nothing about an unparsable date", () => {
    expect(age("not a date", now)).toBe("");
  });
});

describe("arranging a list", () => {
  const rows = [
    item({ id: 1, repo: "me/app", updatedAt: "2026-09-05T00:00:00Z", title: "Fix the importer" }),
    item({ id: 2, repo: "me/hq", kind: "pr", updatedAt: "2026-09-09T00:00:00Z", title: "Ship the board" }),
    item({ id: 3, repo: "me/app", kind: "pr", updatedAt: "2026-09-07T00:00:00Z", title: "Tidy the sweep" }),
    item({ id: 4, repo: "me/app", updatedAt: "2026-09-01T00:00:00Z", title: "Import fixture" }),
  ];
  const view = { kind: "both", repo: "all", search: "", sort: "recent", limit: 50 } as const;

  it("gathers the rows into repositories in the order they appear", () => {
    const { groups, total, shown } = arrangeWork(rows, view);
    expect(total).toBe(4);
    expect(shown).toBe(4);
    expect(groups.map((group) => group.repo)).toEqual(["me/hq", "me/app"]);
    expect(groups[1]?.items.map((row) => row.id)).toEqual([3, 1, 4]);
  });
  it("reverses on the oldest sort", () => {
    const oldest = arrangeWork(rows, { ...view, sort: "oldest" });
    expect(oldest.groups.map((group) => group.repo)).toEqual(["me/app", "me/hq"]);
    expect(oldest.groups[0]?.items.map((row) => row.id)).toEqual([4, 1, 3]);
  });
  it("filters by kind, repository, and a search over the title", () => {
    expect(arrangeWork(rows, { ...view, kind: "pr" }).total).toBe(2);
    expect(arrangeWork(rows, { ...view, repo: "me/app" }).total).toBe(3);
    expect(arrangeWork(rows, { ...view, search: "  IMPORT " }).total).toBe(2);
    expect(arrangeWork(rows, { ...view, search: "nothing" }).groups).toEqual([]);
  });
  it("cuts to the limit but still counts everything that matched", () => {
    const page = arrangeWork(rows, { ...view, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.shown).toBe(2);
    expect(page.groups.flatMap((group) => group.items).map((row) => row.id)).toEqual([2, 3]);
  });
  it("counts the repositories, the fullest first", () => {
    expect(repoOptions(rows)).toEqual([
      { repo: "me/app", count: 3 },
      { repo: "me/hq", count: 1 },
    ]);
  });
});

describe("tabItems", () => {
  const work = buildOpenWork(
    {
      assigned: [item({ id: 1, assignedToMe: true })],
      reviewRequested: [item({ id: 2, kind: "pr" })],
      authored: [item({ id: 3, kind: "pr" })],
      everything: [item({ id: 4 })],
    },
    "2026-09-10T00:00:00Z",
  );
  it("hands back the list the tab stands for", () => {
    expect(tabItems(work, "assigned").map((row) => row.id)).toEqual([1]);
    expect(tabItems(work, "reviews").map((row) => row.id)).toEqual([2]);
    expect(tabItems(work, "authored").map((row) => row.id)).toEqual([3]);
    expect(tabItems(work, "all")).toHaveLength(4);
    expect(tabItems(undefined, "all")).toEqual([]);
  });
});

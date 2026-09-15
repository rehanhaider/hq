import { describe, expect, it } from "vitest";
import {
  age,
  buildOpenWork,
  countKinds,
  dedupe,
  normalise,
  normaliseAll,
  repoOf,
  sweepQueries,
  arrangeWork,
  repoOptions,
  splitByKind,
  tabCounts,
  tabItems,
  showsAuthor,
  searchResponseSchema,
  COLLAPSED_REPOS_KEY,
  collapseAllRepos,
  expandAllRepos,
  readCollapsedRepos,
  writeCollapsedRepos,
  toggleCollapsedRepo,
  visibleWorkRepos,
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
    unassigned: true,
    reasons: [],
    ...overrides,
  };
}

describe("normalise", () => {
  it("reads the repository out of the API url", () => {
    expect(repoOf("https://api.github.com/repos/acme/widget")).toBe("acme/widget");
  });
  it("calls a result with a pull_request a pull request", () => {
    expect(normalise(raw({ pull_request: { url: "x" }, draft: true })).kind).toBe("pr");
    expect(normalise(raw()).kind).toBe("issue");
    expect(normalise(raw({ pull_request: { url: "x" }, draft: true })).draft).toBe(true);
  });
  it("marks a row with nobody on it unassigned", () => {
    expect(normalise(raw({ assignees: [] })).unassigned).toBe(true);
    expect(normalise(raw({ assignees: [{ login: "me" }] })).unassigned).toBe(false);
    expect(normalise(raw({ assignees: [], assignee: { login: "them" } })).unassigned).toBe(false);
  });
  it("keeps labels with their colour and survives a missing author", () => {
    const row = normalise(raw({ user: null }));
    expect(row.author).toBe("unknown");
    expect(row.labels).toEqual([{ name: "bug", color: "d73a4a" }]);
  });
  it("parses a search response", () => {
    const parsed = searchResponseSchema.parse({ total_count: 1, items: [raw()] });
    expect(normaliseAll(parsed.items)).toHaveLength(1);
  });
});

describe("dedupe", () => {
  it("keeps one row per id however many searches found it", () => {
    const rows = dedupe([
      item({ id: 1, title: "first" }),
      item({ id: 1, title: "again" }),
      item({ id: 2 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(rows[0]?.title).toBe("first");
  });
});

describe("countKinds", () => {
  it("counts pull requests and issues apart", () => {
    expect(
      countKinds([item({ id: 1 }), item({ id: 2, kind: "pr" }), item({ id: 3, kind: "pr" })]),
    ).toEqual({ issues: 1, prs: 2 });
  });
});

describe("buildOpenWork", () => {
  const work = buildOpenWork(
    {
      assigned: [item({ id: 1, unassigned: false, createdAt: "2026-09-03T00:00:00Z" })],
      reviewRequested: [
        item({ id: 2, kind: "pr", unassigned: false, createdAt: "2026-09-01T00:00:00Z" }),
      ],
      authored: [
        item({ id: 1, unassigned: false, createdAt: "2026-09-03T00:00:00Z" }),
        item({ id: 3, kind: "pr", createdAt: "2026-09-02T00:00:00Z" }),
      ],
      everything: [
        item({ id: 3, kind: "pr", createdAt: "2026-09-02T00:00:00Z" }),
        item({ id: 4, createdAt: "2026-09-04T00:00:00Z" }),
        item({ id: 5, unassigned: false, createdAt: "2026-09-05T00:00:00Z" }),
        item({ id: 4, createdAt: "2026-09-04T00:00:00Z" }),
      ],
    },
    "2026-09-10T00:00:00Z",
  );
  it("unions the three personal searches into one list, oldest first", () => {
    expect(work.mine.map((row) => row.id)).toEqual([2, 3, 1]);
  });
  it("leaves the assigned rows out of triage and keeps the rest once", () => {
    expect(work.triage.map((row) => row.id)).toEqual([3, 4]);
  });
  it("lets a row of mine that nobody was given stand in both lists", () => {
    expect(work.mine.some((row) => row.id === 3)).toBe(true);
    expect(work.triage.some((row) => row.id === 3)).toBe(true);
    expect(work.connected).toBe(true);
    expect(work.error).toBeUndefined();
  });
  it("remembers every search that found a row, in search order", () => {
    const byId = new Map(work.mine.map((row) => [row.id, row]));
    expect(byId.get(1)?.reasons).toEqual(["assigned", "authored"]);
    expect(byId.get(2)?.reasons).toEqual(["review"]);
    expect(byId.get(3)?.reasons).toEqual(["authored"]);
  });
  it("carries the signed-in login when one is given", () => {
    const named = buildOpenWork(
      { assigned: [], reviewRequested: [], authored: [], everything: [] },
      "2026-09-10T00:00:00Z",
      undefined,
      "me",
    );
    expect(named.login).toBe("me");
  });
  it("keeps an error string when one is given", () => {
    const failed = buildOpenWork(
      { assigned: [], reviewRequested: [], authored: [], everything: [] },
      "2026-09-10T00:00:00Z",
      "GitHub request limit reached.",
    );
    expect(failed.error).toBe("GitHub request limit reached.");
    expect(failed.mine).toEqual([]);
    expect(failed.triage).toEqual([]);
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
  const view = { repo: "all", search: "", sort: "recent", limit: 50 } as const;

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
  it("splits the rows into issues and pull requests", () => {
    const { issue, pr } = splitByKind(rows);
    expect(issue.map((row) => row.id)).toEqual([1, 4]);
    expect(pr.map((row) => row.id)).toEqual([2, 3]);
  });
  it("filters by repository and a search over the title", () => {
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
  it("counts the repositories through the other filters", () => {
    expect(repoOptions(splitByKind(rows).pr, { repo: "all", search: "" })).toEqual([
      { repo: "me/app", count: 1 },
      { repo: "me/hq", count: 1 },
    ]);
    expect(repoOptions(rows, { repo: "all", search: "import" })).toEqual([
      { repo: "me/app", count: 2 },
    ]);
  });
});

describe("the tabs", () => {
  const work = buildOpenWork(
    {
      assigned: [item({ id: 1, unassigned: false, title: "Fix the importer" })],
      reviewRequested: [item({ id: 2, kind: "pr", unassigned: false, title: "Ship it" })],
      authored: [item({ id: 3, kind: "pr", unassigned: false, title: "Tidy up" })],
      everything: [item({ id: 4, repo: "me/hq", title: "Triage me" }), item({ id: 5, kind: "pr" })],
    },
    "2026-09-10T00:00:00Z",
  );
  const all = { repo: "all", search: "" } as const;

  it("hands back the list the tab stands for", () => {
    expect(tabItems(work, "mine").map((row) => row.id)).toEqual([1, 2, 3]);
    expect(tabItems(work, "triage").map((row) => row.id)).toEqual([5, 4]);
    expect(tabItems(undefined, "mine")).toEqual([]);
  });
  it("counts both tabs through the filters below them", () => {
    expect(tabCounts(work, all)).toEqual({ mine: 3, triage: 2 });
    expect(tabCounts(work, { ...all, repo: "me/hq" })).toEqual({ mine: 0, triage: 1 });
    expect(tabCounts(work, { ...all, search: "ship" })).toEqual({ mine: 1, triage: 0 });
    expect(tabCounts(undefined, all)).toEqual({ mine: 0, triage: 0 });
  });
});

describe("showsAuthor", () => {
  it("names the opener on triage even when the row is yours", () => {
    expect(showsAuthor(item({ author: "me" }), "triage", "me")).toBe(true);
  });
  it("hides the opener on Mine only when it is the signed-in login", () => {
    expect(showsAuthor(item({ author: "me" }), "mine", "me")).toBe(false);
    expect(showsAuthor(item({ author: "Me" }), "mine", "me")).toBe(false);
    expect(showsAuthor(item({ author: "them" }), "mine", "me")).toBe(true);
  });
  it("keeps the opener on Mine when the signed-in login is unknown", () => {
    expect(showsAuthor(item({ author: "them" }), "mine")).toBe(true);
  });
});

describe("collapsed repository cards", () => {
  function memory(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => {
        data.delete(key);
      },
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
  }

  it("starts empty when nothing is stored", () => {
    expect(readCollapsedRepos(memory())).toEqual([]);
    expect(readCollapsedRepos(null)).toEqual([]);
  });

  it("round-trips the folded names through storage", () => {
    const store = memory();
    writeCollapsedRepos(["me/hq", "me/app"], store);
    expect(store.getItem(COLLAPSED_REPOS_KEY)).toBe(
      JSON.stringify(["me/hq", "me/app"]),
    );
    expect(readCollapsedRepos(store)).toEqual(["me/hq", "me/app"]);
  });

  it("ignores a corrupt or non-array payload", () => {
    const store = memory();
    store.setItem(COLLAPSED_REPOS_KEY, "{");
    expect(readCollapsedRepos(store)).toEqual([]);
    store.setItem(COLLAPSED_REPOS_KEY, JSON.stringify({ repo: "me/app" }));
    expect(readCollapsedRepos(store)).toEqual([]);
    store.setItem(COLLAPSED_REPOS_KEY, JSON.stringify(["me/app", 3, null]));
    expect(readCollapsedRepos(store)).toEqual(["me/app"]);
  });

  it("folds and unfolds one repository without disturbing the others", () => {
    expect(toggleCollapsedRepo([], "me/app")).toEqual(["me/app"]);
    expect(toggleCollapsedRepo(["me/app", "me/hq"], "me/app")).toEqual([
      "me/hq",
    ]);
    expect(toggleCollapsedRepo(["me/hq"], "me/app")).toEqual([
      "me/app",
      "me/hq",
    ]);
  });

  it("folds every visible repository into the collapsed set", () => {
    expect(collapseAllRepos([], ["me/app", "me/hq"])).toEqual([
      "me/app",
      "me/hq",
    ]);
    expect(collapseAllRepos(["me/old"], ["me/app", "me/hq"])).toEqual([
      "me/app",
      "me/hq",
      "me/old",
    ]);
    expect(collapseAllRepos(["me/app"], ["me/app", "me/hq"])).toEqual([
      "me/app",
      "me/hq",
    ]);
  });

  it("unfolds every visible repository and leaves the rest folded", () => {
    expect(expandAllRepos(["me/app", "me/hq", "me/old"], ["me/app", "me/hq"])).toEqual([
      "me/old",
    ]);
    expect(expandAllRepos(["me/old"], ["me/app"])).toEqual(["me/old"]);
    expect(expandAllRepos(["me/app"], [])).toEqual(["me/app"]);
    expect(expandAllRepos([], ["me/app"])).toEqual([]);
  });

  it("names the repositories currently arranged in the active panes", () => {
    const kinds = {
      issue: [
        item({ id: 1, kind: "issue", repo: "me/app", updatedAt: "2024-06-02" }),
        item({ id: 2, kind: "issue", repo: "me/hq", updatedAt: "2024-06-01" }),
      ],
      pr: [
        item({
          id: 3,
          kind: "pr",
          repo: "me/app",
          updatedAt: "2024-06-03",
          title: "Ship it",
        }),
        item({
          id: 4,
          kind: "pr",
          repo: "them/other",
          updatedAt: "2024-06-04",
          title: "Elsewhere",
        }),
      ],
    };
    const views = {
      issue: { repo: "all", search: "", sort: "recent" as const, limit: 50 },
      pr: { repo: "all", search: "", sort: "recent" as const, limit: 50 },
    };
    expect(visibleWorkRepos(kinds, views, "both")).toEqual([
      "me/app",
      "me/hq",
      "them/other",
    ]);
    expect(visibleWorkRepos(kinds, views, "issue")).toEqual(["me/app", "me/hq"]);
    expect(visibleWorkRepos(kinds, views, "pr")).toEqual([
      "me/app",
      "them/other",
    ]);
    expect(
      visibleWorkRepos(kinds, {
        ...views,
        issue: { ...views.issue, repo: "me/hq" },
      }, "both"),
    ).toEqual(["me/app", "me/hq", "them/other"]);
    expect(
      visibleWorkRepos(kinds, {
        ...views,
        pr: { ...views.pr, limit: 1 },
      }, "pr"),
    ).toEqual(["them/other"]);
  });
});

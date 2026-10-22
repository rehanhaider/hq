import { describe, expect, it } from "vitest";
import {
  attentionCounts,
  attentionStatus,
  goingStale,
  isInboxZero,
  isStale,
  ownDrafts,
  reasonLabel,
  summariseAttention,
  triageTop,
  waitingOnYou,
} from "./attention";
import { buildOpenWork } from "./openWork";
import type { WorkItem } from "./openWork";

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
    unassigned: false,
    reasons: [],
    ...overrides,
  };
}

const NOW = Date.parse("2026-09-14T00:00:00Z");

describe("waitingOnYou", () => {
  const mine = [
    item({ id: 1, updatedAt: "2026-09-10T00:00:00Z", reasons: ["authored"] }),
    item({ id: 2, updatedAt: "2026-09-12T00:00:00Z", reasons: ["assigned"] }),
    item({ id: 3, updatedAt: "2026-09-11T00:00:00Z", reasons: ["review", "assigned"] }),
  ];
  it("keeps review and assignment, oldest first, authorship out", () => {
    expect(waitingOnYou(mine).map((row) => row.id)).toEqual([3, 2]);
  });
  it("narrows to the chosen repositories", () => {
    const rows = waitingOnYou(
      [...mine, item({ id: 4, repo: "me/other", reasons: ["review"] })],
      ["me/other"],
    );
    expect(rows.map((row) => row.id)).toEqual([4]);
  });
  it("treats an empty selection as none", () => {
    expect(waitingOnYou(mine, []).map((row) => row.id)).toEqual([]);
  });
});

describe("goingStale", () => {
  it("keeps rows quiet for two weeks, oldest first", () => {
    const mine = [
      item({ id: 1, updatedAt: "2026-08-20T00:00:00Z" }),
      item({ id: 2, updatedAt: "2026-09-13T12:00:00Z" }),
      item({ id: 3, updatedAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(goingStale(mine, "all", 5, NOW).map((row) => row.id)).toEqual([3, 1]);
  });
});

describe("ownDrafts", () => {
  it("keeps only my draft pull requests", () => {
    const mine = [
      item({ id: 1, kind: "pr", draft: true, author: "me" }),
      item({ id: 2, kind: "pr", draft: true, author: "someone" }),
      item({ id: 3, kind: "pr", draft: false, author: "me" }),
      item({ id: 4, kind: "issue", draft: true, author: "me" }),
    ];
    expect(ownDrafts(mine, "me").map((row) => row.id)).toEqual([1]);
  });
});

describe("triageTop", () => {
  it("keeps the oldest unassigned rows", () => {
    const triage = [
      item({ id: 1, updatedAt: "2026-09-10T00:00:00Z" }),
      item({ id: 2, updatedAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(triageTop(triage).map((row) => row.id)).toEqual([2, 1]);
  });
});

describe("reasonLabel", () => {
  it("names review before assignment before authorship", () => {
    expect(reasonLabel(item({ reasons: ["authored", "assigned"] }))).toBe(
      "Assigned to you",
    );
    expect(reasonLabel(item({ reasons: ["authored", "review"] }))).toBe(
      "Review requested",
    );
    expect(reasonLabel(item({ reasons: ["authored"] }))).toBe("You opened");
    expect(reasonLabel(item({ reasons: [], unassigned: true }))).toBe(
      "Needs triage",
    );
  });
  it("reads a row cut down for Home, which carries no assignee flag", () => {
    expect(reasonLabel({ reasons: ["assigned", "review"] })).toBe(
      "Review requested",
    );
    expect(reasonLabel({ reasons: ["assigned"] })).toBe("Assigned to you");
  });
});

describe("attentionCounts", () => {
  it("counts the four headline figures", () => {
    const work = buildOpenWork(
      {
        assigned: [item({ id: 1 })],
        reviewRequested: [item({ id: 2, kind: "pr" })],
        authored: [item({ id: 3, kind: "pr" })],
        everything: [item({ id: 4, unassigned: true })],
      },
      "2026-09-14T00:00:00Z",
    );
    expect(attentionCounts(work)).toEqual({
      needsYou: 2,
      triage: 1,
      openIssues: 1,
      openPrs: 2,
    });
  });

  it("counts Needs you and triage inside the repo filter", () => {
    const work = buildOpenWork(
      {
        assigned: [
          item({ id: 1, repo: "me/app" }),
          item({ id: 5, repo: "me/other" }),
        ],
        reviewRequested: [item({ id: 2, kind: "pr", repo: "me/app" })],
        authored: [item({ id: 3, kind: "pr", repo: "me/app" })],
        everything: [
          item({ id: 4, unassigned: true, repo: "me/app" }),
          item({ id: 6, unassigned: true, repo: "me/other" }),
        ],
      },
      "2026-09-14T00:00:00Z",
    );
    expect(attentionCounts(work, ["me/other"])).toEqual({
      needsYou: 1,
      triage: 1,
      openIssues: 1,
      openPrs: 0,
    });
    expect(attentionCounts(work, [])).toEqual({
      needsYou: 0,
      triage: 0,
      openIssues: 0,
      openPrs: 0,
    });
  });
});

describe("isInboxZero", () => {
  const empty = buildOpenWork(
    { assigned: [], reviewRequested: [], authored: [], everything: [] },
    "2026-09-14T00:00:00Z",
  );

  it("is true only when connected lists are empty and the fetch succeeded", () => {
    expect(isInboxZero(empty, 0)).toBe(true);
    expect(isInboxZero(empty, 3)).toBe(false);
    expect(isInboxZero(undefined, 0)).toBe(false);
  });

  it("is false when the query failed or GitHub returned an error", () => {
    expect(isInboxZero(empty, 0, new Error("rate limit"))).toBe(false);
    expect(
      isInboxZero(
        buildOpenWork(
          { assigned: [], reviewRequested: [], authored: [], everything: [] },
          "2026-09-14T00:00:00Z",
          "GitHub request limit reached.",
        ),
        0,
      ),
    ).toBe(false);
  });
});

describe("isStale", () => {
  it("holds from fourteen days without an update", () => {
    expect(isStale("2026-08-31T00:00:00Z", NOW)).toBe(true);
    expect(isStale("2026-08-31T00:00:01Z", NOW)).toBe(false);
    expect(isStale("not a date", NOW)).toBe(false);
  });
});

const waiting = buildOpenWork(
  {
    assigned: [
      item({ id: 1, updatedAt: "2026-09-12T00:00:00Z" }),
      item({ id: 2, kind: "pr", draft: true, updatedAt: "2026-08-20T00:00:00Z" }),
    ],
    reviewRequested: [
      item({ id: 3, kind: "pr", updatedAt: "2026-09-10T00:00:00Z" }),
      item({ id: 4, kind: "pr", updatedAt: "2026-09-01T00:00:00Z" }),
    ],
    authored: [item({ id: 5, updatedAt: "2026-08-01T00:00:00Z" })],
    everything: [item({ id: 6, unassigned: true }), item({ id: 7, unassigned: true })],
  },
  "2026-09-14T00:00:00Z",
);

describe("summariseAttention", () => {
  const row = (id: number) => {
    const { url, repo, number, title, updatedAt, reasons, draft } =
      waiting.mine.find((entry) => entry.id === id)!;
    return { id, url, repo, number, title, updatedAt, reasons, draft };
  };

  it("carries the figures and the first waiting rows, in the Overview's order", () => {
    expect(summariseAttention(waiting, NOW)).toEqual({
      connected: true,
      fetchedAt: "2026-09-14T00:00:00Z",
      needsYou: 4,
      triage: 2,
      // The draft and the authored row have both been quiet for 14+ days.
      stale: 2,
      reviews: { count: 2, quietSince: "2026-09-01T00:00:00Z" },
      // Review and assignment only, the quietest first.
      waiting: [row(2), row(4), row(3), row(1)],
    });
  });

  it("keeps five rows but counts every one", () => {
    const many = buildOpenWork(
      {
        assigned: [1, 2, 3, 4, 5, 6, 7].map((id) => item({ id })),
        reviewRequested: [],
        authored: [],
        everything: [],
      },
      "2026-09-14T00:00:00Z",
    );
    const summary = summariseAttention(many, NOW);
    expect(summary.waiting).toHaveLength(5);
    expect(summary.needsYou).toBe(7);
  });

  it("carries the error and the disconnected state through", () => {
    expect(
      summariseAttention(
        {
          connected: false,
          mine: [],
          triage: [],
          fetchedAt: "2026-09-14T00:00:00Z",
          error: "Set GITHUB_TOKEN on the server.",
        },
        NOW,
      ),
    ).toEqual({
      connected: false,
      fetchedAt: "2026-09-14T00:00:00Z",
      error: "Set GITHUB_TOKEN on the server.",
      needsYou: 0,
      triage: 0,
      stale: 0,
      reviews: { count: 0, quietSince: null },
      waiting: [],
    });
  });
});

describe("attentionStatus", () => {
  const summary = summariseAttention(waiting, NOW);

  it("says how many reviews wait and for how long, then what needs you", () => {
    expect(attentionStatus(summary, NOW)).toEqual([
      { id: "reviews", card: "waiting", lead: "2", text: "reviews waiting", tail: "13d" },
      { id: "needs", card: "waiting", lead: "4", text: "need you" },
    ]);
  });

  it("uses the singular for one", () => {
    const one = {
      ...summary,
      needsYou: 1,
      reviews: { count: 1, quietSince: "2026-09-13T00:00:00Z" },
    };
    expect(attentionStatus(one, NOW)).toEqual([
      { id: "reviews", card: "waiting", lead: "1", text: "review waiting", tail: "1d" },
      { id: "needs", card: "waiting", lead: "1", text: "needs you" },
    ]);
  });

  it("leaves out a figure that is zero", () => {
    expect(
      attentionStatus(
        { ...summary, needsYou: 0, reviews: { count: 0, quietSince: null } },
        NOW,
      ),
    ).toEqual([]);
  });

  it("says nothing while GitHub is not connected or not read yet", () => {
    expect(attentionStatus({ ...summary, connected: false }, NOW)).toEqual([]);
    expect(attentionStatus(undefined, NOW)).toEqual([]);
    expect(attentionStatus(null, NOW)).toEqual([]);
  });
});

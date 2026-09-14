import { describe, expect, it } from "vitest";
import {
  attentionCounts,
  goingStale,
  isInboxZero,
  ownDrafts,
  reasonLabel,
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
});

describe("goingStale", () => {
  it("keeps rows quiet for two weeks, oldest first", () => {
    const mine = [
      item({ id: 1, updatedAt: "2026-08-20T00:00:00Z" }),
      item({ id: 2, updatedAt: "2026-09-13T12:00:00Z" }),
      item({ id: 3, updatedAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(goingStale(mine, [], 5, NOW).map((row) => row.id)).toEqual([3, 1]);
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

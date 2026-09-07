import { describe, expect, it } from "vitest";
import {
  connectionRow,
  connectionSummary,
  isFatalImportError,
} from "./connections";
import type { Snapshot } from "./model";

const snapshot: Snapshot = {
  repo: {
    id: 1,
    fullName: "me/app",
    private: true,
    language: "TypeScript",
    defaultBranch: "main",
    pushedAt: null,
  },
  since: "2026-06-09T00:00:00.000Z",
  until: "2026-09-07T12:00:00.000Z",
  importedAt: "2026-09-07T12:00:00.000Z",
  commits: [
    {
      sha: "a",
      title: "Feature",
      url: "https://github.com/me/app/commit/a",
      date: "2026-08-01T00:00:00.000Z",
      merge: false,
      additions: 10,
      deletions: 1,
      languages: { TypeScript: { additions: 10, deletions: 1 } },
      categories: { Code: { additions: 10, deletions: 1 } },
    },
    {
      sha: "b",
      title: "Old",
      url: "https://github.com/me/app/commit/b",
      date: "2026-07-01T00:00:00.000Z",
      merge: false,
      additions: 4,
      deletions: 0,
      categories: { Unclassified: { additions: 4, deletions: 0 } },
    },
    {
      sha: "c",
      title: "Merge",
      url: "https://github.com/me/app/commit/c",
      date: "2026-07-02T00:00:00.000Z",
      merge: true,
      additions: 8,
      deletions: 2,
      categories: {},
    },
  ],
  prs: [
    {
      number: 1,
      title: "Ship",
      url: "https://github.com/me/app/pull/1",
      author: "me",
      mergedBy: "me",
      createdAt: "2026-07-01T00:00:00.000Z",
      mergedAt: "2026-07-02T00:00:00.000Z",
      additions: 10,
      deletions: 1,
    },
  ],
};

describe("connection rows", () => {
  it("counts file-detail sync against non-merge commits and keeps merge commits in the commit total", () => {
    const row = connectionRow(snapshot);
    expect(row.connection).toBe("ok");
    expect(row.metrics.commits).toEqual({ ready: 3, total: 3 });
    expect(row.metrics.pullRequests).toEqual({ ready: 1, total: 1 });
    expect(row.metrics.languages).toEqual({ ready: 1, total: 2 });
    expect(row.metrics.additions).toBe(14);
    expect(row.metrics.deletions).toBe(1);
  });

  it("surfaces a per-repository fetch failure without dropping stored counts", () => {
    const row = connectionRow(snapshot, {
      fullName: "me/app",
      state: "error",
      error: "A repository is unavailable to this token.",
      lastSuccessAt: snapshot.importedAt,
      lastAttemptAt: "2026-09-07T13:00:00.000Z",
    });
    expect(row.connection).toBe("error");
    expect(row.error).toMatch(/unavailable/);
    expect(row.metrics.commits.ready).toBe(3);
  });

  it("summarises connected, failed, and incomplete file-detail rows", () => {
    const ok = connectionRow(snapshot);
    const failed = connectionRow(
      { ...snapshot, repo: { ...snapshot.repo, id: 2, fullName: "me/other" } },
      {
        fullName: "me/other",
        state: "error",
        error: "denied",
        lastSuccessAt: null,
        lastAttemptAt: snapshot.importedAt,
      },
    );
    expect(connectionSummary([ok, failed])).toEqual({
      repositories: 2,
      connected: 1,
      syncing: 0,
      failed: 1,
      incompleteLanguages: 2,
    });
  });

  it("stops the run only for token, network, and rate-limit failures", () => {
    expect(isFatalImportError("GitHub request limit reached.")).toBe(true);
    expect(isFatalImportError("GitHub rejected the token. Update GITHUB_TOKEN")).toBe(
      true,
    );
    expect(isFatalImportError("Could not reach GitHub. Check the server")).toBe(
      true,
    );
    expect(
      isFatalImportError("A repository is unavailable to this token."),
    ).toBe(false);
  });
});

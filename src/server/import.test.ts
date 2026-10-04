import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityStore, getStore } from "./db";
import { GithubClient } from "./github";
import {
  importRepository,
  importWindowStart,
  lateWindowStart,
  mergeSnapshot,
  refreshIntervalMs,
  startRefresh,
} from "./import";
import type { Commit, PullRequest, Snapshot } from "../lib/model";

let store: ActivityStore;
afterEach(() => {
  if (store?.db.isOpen) store.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const repo = {
  id: 1,
  fullName: "me/app",
  private: false,
  language: "TypeScript",
  defaultBranch: "main",
  pushedAt: null,
};
const since = "2026-08-01T00:00:00.000Z",
  until = "2026-09-01T00:00:00.000Z";
function fixture() {
  store = new ActivityStore(":memory:");
  const client = new GithubClient("test-only");
  vi.spyOn(client, "repository").mockResolvedValue(repo);
  vi.spyOn(client, "pulls").mockResolvedValue({
    nodes: [
      {
        number: 1,
        title: "Shipped",
        url: "https://github.com/me/app/pull/1",
        author: { login: "me" },
        mergedBy: { login: "other" },
        mergedAt: "2026-08-03T00:00:00Z",
        createdAt: "2026-08-02T00:00:00Z",
        updatedAt: "2026-08-03T00:00:00Z",
        additions: 300,
        deletions: 20,
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (path) => {
      if (path.includes("per_page=1&"))
        return { body: [{ sha: "pinned-head" }], next: false };
      if (path.includes("/commits?")) {
        expect(path).toContain("sha=pinned-head");
        expect(path).toContain("author=me");
        return { body: [{ sha: "abc" }], next: false };
      }
      if (path.includes("page=2"))
        return {
          body: {
            files: [
              { filename: "tests/app.test.ts", additions: 2, deletions: 0 },
            ],
          },
          next: false,
        };
      return {
        body: {
          sha: "abc",
          html_url: "https://github.com/me/app/commit/abc",
          commit: {
            message: "A feature\n\nDescription",
            committer: { date: "2026-08-02T00:00:00Z" },
          },
          parents: [{ sha: "parent" }],
          stats: { additions: 10, deletions: 1 },
          files: [{ filename: "src/app.ts", additions: 8, deletions: 1 }],
        },
        next: true,
      };
    });
  return { client, request };
}
describe("repository import", () => {
  it("includes PRs at the exact upper timestamp after normalizing GitHub dates", async () => {
    const { client } = fixture();
    const result = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      "2026-08-03T00:00:00.000Z",
      () => {},
    );
    expect(result.prs).toHaveLength(1);
  });
  it("excludes other authors even when the account merged their PR", async () => {
    const { client } = fixture();
    const response = await client.pulls(repo.fullName, null);
    vi.mocked(client.pulls).mockResolvedValue({
      ...response,
      nodes: [
        ...response.nodes,
        {
          ...response.nodes[0]!,
          number: 2,
          author: { login: "other" },
          mergedBy: { login: "me" },
        },
      ],
    });
    const result = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(result.prs.map((pr) => pr.number)).toEqual([1]);
  });
  it("pins pagination, reads all file pages, and retains PR authorship separately", async () => {
    const { client, request } = fixture();
    const snapshot = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(snapshot.commits[0]?.categories).toEqual({
      Code: { additions: 8, deletions: 1 },
      Tests: { additions: 2, deletions: 0 },
    });
    expect(snapshot.commits[0]?.languages).toEqual({
      TypeScript: { additions: 10, deletions: 1 },
    });
    expect(snapshot.commits[0]?.title).toBe("A feature");
    expect(snapshot.prs[0]?.author).toBe("me");
    expect(snapshot.prs[0]?.mergedBy).toBe("other");
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("reuses immutable commit details but reconciles branch membership on refresh", async () => {
    const { client, request } = fixture();
    const first = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    store.save(first);
    request.mockClear();
    const again = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(again.commits).toEqual(first.commits);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockImplementation(async (path) => ({
      body: path.includes("per_page=1&") ? [{ sha: "new-head" }] : [],
      next: false,
    }));
    const changed = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    store.save(changed);
    expect(store.snapshot(repo.fullName)?.commits).toEqual([]);
  });
  it("refreshes old commits to collect missing language details", async () => {
    const { client, request } = fixture();
    const first = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    delete first.commits[0]!.languages;
    store.save(first);
    request.mockClear();
    const refreshed = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(refreshed.commits[0]?.languages).toEqual({
      TypeScript: { additions: 10, deletions: 1 },
    });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("keeps the previous complete snapshot when a GitHub request fails", async () => {
    const { client, request } = fixture();
    const first = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    store.save(first);
    request.mockRejectedValue(new Error("GitHub request limit reached"));
    await expect(
      importRepository(
        client,
        store,
        repo.fullName,
        "me",
        since,
        until,
        () => {},
      ),
    ).rejects.toThrow("limit reached");
    expect(store.snapshot(repo.fullName)).toEqual(first);
  });
  it("preserves commit totals and puts missing file statistics in Unclassified", async () => {
    const { client, request } = fixture();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      return path.includes("/commits/abc?")
        ? { ...result, next: false }
        : result;
    });
    const result = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(result.commits[0]?.additions).toBe(10);
    expect(result.commits[0]?.categories).toEqual({
      Code: { additions: 8, deletions: 1 },
      Unclassified: { additions: 2, deletions: 0 },
    });
    expect(result.commits[0]?.languages).toEqual({
      TypeScript: { additions: 8, deletions: 1 },
      Unclassified: { additions: 2, deletions: 0 },
    });
    store.save(result);
    expect(store.snapshot(repo.fullName)?.commits).toEqual(result.commits);
  });
  it("does not invent negative categories when listed files exceed commit totals", async () => {
    const { client, request } = fixture();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      if (path.includes("/commits/abc?") && !path.includes("page=2"))
        return {
          ...result,
          body: {
            ...(result.body as object),
            stats: { additions: 1, deletions: 0 },
          },
        };
      return result;
    });
    const result = await importRepository(
      client,
      store,
      repo.fullName,
      "me",
      since,
      until,
      () => {},
    );
    expect(result.commits[0]?.categories).toEqual({
      Unclassified: { additions: 1, deletions: 0 },
    });
    expect(result.commits[0]?.languages).toEqual({
      Unclassified: { additions: 1, deletions: 0 },
    });
  });
});

describe("GitHub response handling", () => {
  it("treats an explicitly empty repository as zero commits", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ message: "Git Repository is empty." }),
            { status: 409 },
          ),
        ),
    );
    const client = new GithubClient("test-only");
    expect(await client.request("/repos/me/empty/commits?per_page=1")).toEqual({
      body: [],
      next: false,
    });
  });
  it("reports a comparison from a missing base as unavailable, not as an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
          }),
      ),
    );
    const client = new GithubClient("test-only");
    expect(
      await client.request("/repos/me/app/compare/gone...head?per_page=100"),
    ).toEqual({ body: null, next: false });
    await expect(client.request("/repos/me/app/commits/gone")).rejects.toThrow(
      "unavailable",
    );
  });
  it("does not turn another conflict into an empty history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Another conflict" }), {
          status: 409,
        }),
      ),
    );
    await expect(
      new GithubClient("test-only").request("/repos/me/app/commits?per_page=1"),
    ).rejects.toThrow("HTTP 409");
  });
  it("reports rate limits without retrying or disclosing the token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1800000000",
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(new GithubClient("secret-test-token").user()).rejects.toThrow(
      "GitHub request limit reached",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function commit(sha: string, date: string): Commit {
  return {
    sha,
    title: sha,
    url: `https://github.com/me/app/commit/${sha}`,
    date,
    merge: false,
    additions: 1,
    deletions: 0,
    categories: { Code: { additions: 1, deletions: 0 } },
  };
}

function pr(number: number): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/me/app/pull/${number}`,
    author: "me",
    mergedBy: "me",
    createdAt: "2026-08-01T00:00:00.000Z",
    mergedAt: "2026-08-02T00:00:00.000Z",
    additions: 10,
    deletions: 1,
  };
}

describe("delta refresh", () => {
  const previous: Snapshot = {
    repo,
    commits: [commit("old", "2026-01-02T00:00:00.000Z")],
    prs: [pr(1)],
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-08-01T00:00:00.000Z",
    importedAt: "2026-08-01T00:00:00.000Z",
  };

  it("keeps earlier history when a refresh only returns recent work", () => {
    const incoming: Snapshot = {
      ...previous,
      commits: [commit("new", "2026-09-06T00:00:00.000Z")],
      prs: [pr(2)],
      since: "2026-09-05T00:00:00.000Z",
      until: "2026-09-07T12:00:00.000Z",
      importedAt: "2026-09-07T12:00:00.000Z",
    };
    const merged = mergeSnapshot(previous, incoming);
    expect(merged.commits.map((item) => item.sha)).toEqual(["old", "new"]);
    expect(merged.prs.map((item) => item.number)).toEqual([1, 2]);
    expect(merged.since).toBe(previous.since);
    expect(merged.until).toBe(incoming.until);
    expect(merged.importedAt).toBe(incoming.importedAt);
  });

  it("lets the newer snapshot win for the same commit or pull request", () => {
    const incoming: Snapshot = {
      ...previous,
      commits: [
        { ...commit("old", "2026-01-02T00:00:00.000Z"), title: "Updated" },
      ],
      prs: [{ ...pr(1), title: "Renamed" }],
      until: "2026-09-07T12:00:00.000Z",
    };
    const merged = mergeSnapshot(previous, incoming);
    expect(merged.commits).toHaveLength(1);
    expect(merged.commits[0]?.title).toBe("Updated");
    expect(merged.prs[0]?.title).toBe("Renamed");
  });

  it("reaches back two days from the repository's own last fetch for a date listing", () => {
    expect(
      lateWindowStart({
        since: "2020-01-01T00:00:00.000Z",
        until: "2026-09-07T12:00:00.000Z",
      }),
    ).toBe("2026-09-05T12:00:00.000Z");
    expect(
      lateWindowStart({
        since: "2026-09-06T18:00:00.000Z",
        until: "2026-09-07T12:00:00.000Z",
      }),
    ).toBe("2026-09-06T18:00:00.000Z");
  });

  it("lists by date only for a first import or an earlier backfill", () => {
    const stored = "2026-06-09T00:00:00.000Z";
    expect(
      importWindowStart("manual", undefined, "2025-01-01T00:00:00.000Z"),
    ).toBe("2025-01-01T00:00:00.000Z");
    expect(
      importWindowStart("manual", stored, "2026-06-09T00:00:00.000Z"),
    ).toBeNull();
    expect(
      importWindowStart("manual", stored, "2025-01-01T00:00:00.000Z"),
    ).toBe("2025-01-01T00:00:00.000Z");
    expect(
      importWindowStart("refresh", stored, "1970-01-01T00:00:00.000Z"),
    ).toBeNull();
  });

  it("drops saved commits a date listing no longer finds, and only in its range", () => {
    const incoming: Snapshot = {
      ...previous,
      commits: [commit("rewritten", "2026-07-31T00:00:00.000Z")],
      prs: [],
      since: "2026-07-30T00:00:00.000Z",
      until: "2026-08-02T00:00:00.000Z",
    };
    const merged = mergeSnapshot(
      {
        ...previous,
        commits: [
          ...previous.commits,
          commit("force-pushed-away", "2026-07-31T00:00:00.000Z"),
        ],
      },
      incoming,
    );
    expect(merged.commits.map((item) => item.sha)).toEqual([
      "old",
      "rewritten",
    ]);
  });

  it("treats an empty HQ_REFRESH_MS as fifteen minutes and 0 as off", () => {
    const previousMs = process.env.HQ_REFRESH_MS;
    delete process.env.HQ_REFRESH_MS;
    expect(refreshIntervalMs()).toBe(15 * 60 * 1000);
    process.env.HQ_REFRESH_MS = "0";
    expect(refreshIntervalMs()).toBe(0);
    process.env.HQ_REFRESH_MS = "120000";
    expect(refreshIntervalMs()).toBe(120000);
    if (previousMs === undefined) delete process.env.HQ_REFRESH_MS;
    else process.env.HQ_REFRESH_MS = previousMs;
  });
});

type FakeCommit = { sha: string; date: string; author: string };
type FakeRepo = {
  /** The default branch, oldest first; the last entry is the head. */
  branch: FakeCommit[];
  /** Commits no longer on the branch whose objects GitHub still serves. */
  orphaned: FakeCommit[];
  prs: { number: number; mergedAt: string }[];
  fail?: boolean;
  /** Returns at most this many commits from a comparison, as a cut-off one. */
  compareCap?: number;
};

/** A GitHub that answers each endpoint the import uses from `repos`. */
function fakeGithub(client: GithubClient, repos: Record<string, FakeRepo>) {
  const calls: string[] = [];
  const named = (path: string) => {
    const name = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1] ?? "";
    const state = repos[name];
    if (!state) throw new Error(`unexpected ${path}`);
    if (state.fail) throw new Error("GitHub returned HTTP 502.");
    return { name, state };
  };
  vi.spyOn(client, "user").mockResolvedValue({ login: "me", id: 1 });
  vi.spyOn(client, "repository").mockImplementation(async (name) => {
    named(`/repos/${name}`);
    return { ...repo, fullName: name };
  });
  vi.spyOn(client, "pulls").mockImplementation(async (name) => {
    calls.push(`pulls ${name}`);
    const { state } = named(`/repos/${name}`);
    return {
      nodes: [...state.prs]
        .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
        .map((item) => ({
          number: item.number,
          title: `PR ${item.number}`,
          url: `https://github.com/${name}/pull/${item.number}`,
          author: { login: "me" },
          mergedBy: { login: "me" },
          mergedAt: item.mergedAt,
          createdAt: item.mergedAt,
          updatedAt: item.mergedAt,
          additions: 1,
          deletions: 0,
        })),
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  });
  vi.spyOn(client, "request").mockImplementation(async (path) => {
    calls.push(path);
    const { name, state } = named(path);
    const url = new URL(path, "https://api.github.com");
    const params = url.searchParams;
    if (
      url.pathname === `/repos/${name}/commits` &&
      params.get("per_page") === "1"
    )
      return {
        body: state.branch.slice(-1).map(({ sha }) => ({ sha })),
        next: false,
      };
    if (url.pathname === `/repos/${name}/commits`) {
      const listed = state.branch.filter(
        (item) =>
          item.author === params.get("author") &&
          item.date >= params.get("since")! &&
          (!params.has("until") || item.date <= params.get("until")!),
      );
      return {
        body: listed.reverse().map(({ sha }) => ({ sha })),
        next: false,
      };
    }
    const compare = /\/compare\/(\w[\w-]*)\.\.\.(\w[\w-]*)$/.exec(url.pathname);
    if (compare) {
      const [, base, head] = compare;
      const at = state.branch.findIndex((item) => item.sha === base);
      const known = at >= 0 || state.orphaned.some((item) => item.sha === base);
      if (!known) return { body: null, next: false };
      if (at < 0)
        return {
          body: { status: "diverged", total_commits: 0, commits: [] },
          next: false,
        };
      const ahead = state.branch.slice(at + 1);
      expect(ahead.at(-1)?.sha).toBe(head);
      return {
        body: {
          status: "ahead",
          total_commits: ahead.length,
          commits: ahead.slice(0, state.compareCap).map((item) => ({
            sha: item.sha,
            author: { login: item.author },
          })),
        },
        next: false,
      };
    }
    const sha = url.pathname.split("/").at(-1)!;
    const found = [...state.branch, ...state.orphaned].find(
      (item) => item.sha === sha,
    );
    if (!found) throw new Error(`unexpected ${path}`);
    return {
      body: {
        sha,
        html_url: `https://github.com/${name}/commit/${sha}`,
        commit: { message: sha, committer: { date: found.date } },
        parents: [{ sha: "parent" }],
        stats: { additions: 1, deletions: 0 },
        files: [{ filename: "src/app.ts", additions: 1, deletions: 0 }],
      },
      next: false,
    };
  });
  const kinds = () => ({
    head: calls.filter((c) => c.includes("/commits?per_page=1&")).length,
    list: calls.filter(
      (c) => c.includes("/commits?") && !c.includes("per_page=1&"),
    ).length,
    compare: calls.filter((c) => c.includes("/compare/")).length,
    detail: calls.filter((c) => /\/commits\/[^/?]+\?/.test(c)).length,
    pulls: calls.filter((c) => c.startsWith("pulls ")).length,
  });
  return { calls, kinds };
}

const day = (n: number, hour = 9) =>
  new Date(Date.UTC(2026, 8, n, hour)).toISOString();
const importStart = "2026-08-01T00:00:00.000Z";
const mine = (sha: string, date: string): FakeCommit => ({
  sha,
  date,
  author: "me",
});

describe("incremental refresh", () => {
  /** Imports me/app once, as of Monday 1 September at 09:00. */
  async function importedMonday(state: FakeRepo) {
    store = new ActivityStore(":memory:");
    const client = new GithubClient("test-only");
    const github = fakeGithub(client, { "me/app": state });
    const first = await importRepository(
      client,
      store,
      "me/app",
      "me",
      importStart,
      day(1),
      () => {},
    );
    store.save(mergeSnapshot(null, first));
    github.calls.length = 0;
    const refresh = (until: string) =>
      importRepository(
        client,
        store,
        "me/app",
        "me",
        "1970-01-01T00:00:00.000Z",
        until,
        () => {},
        true,
      ).then((snapshot) => {
        store.save(mergeSnapshot(store.snapshot("me/app"), snapshot));
        return store.snapshot("me/app")!;
      });
    return { github, refresh };
  }

  it("makes no commit list or detail requests when the head has not moved", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    expect(store.snapshot("me/app")?.head).toBe("a");
    const saved = await refresh(day(1, 10));
    expect(github.kinds()).toEqual({
      head: 1,
      list: 0,
      compare: 0,
      detail: 0,
      pulls: 1,
    });
    expect(saved.commits.map((c) => c.sha)).toEqual(["a"]);
    expect(saved.until).toBe(day(1, 10));
  });

  it("keeps a commit pushed after the run started but before the head was read", async () => {
    // The import's cutoff is Monday 09:00; this commit landed at 09:05,
    // before me/app's head was pinned.
    const state: FakeRepo = {
      branch: [
        mine("a", day(1, 8)),
        mine("after-cutoff", "2026-09-01T09:05:00.000Z"),
      ],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    expect(store.snapshot("me/app")?.head).toBe("after-cutoff");
    const saved = await refresh(day(1, 10));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual([
      "a",
      "after-cutoff",
    ]);
    expect(github.kinds()).toMatchObject({ list: 0, compare: 0, detail: 0 });
  });

  it("fetches everything since the repository's last fetch after more than 48 hours down", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    // Monday 09:00 to Friday 09:00 with no refresh.
    state.branch.push(
      mine("tue", day(2)),
      mine("wed", day(3)),
      mine("thu", day(4)),
    );
    state.prs.push(
      { number: 1, mergedAt: day(1, 12) },
      { number: 2, mergedAt: day(4) },
    );
    const saved = await refresh(day(5));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual([
      "a",
      "thu",
      "tue",
      "wed",
    ]);
    expect(saved.prs.map((p) => p.number).sort()).toEqual([1, 2]);
    expect(saved.head).toBe("thu");
    expect(github.kinds()).toMatchObject({ list: 0, compare: 1, detail: 3 });
  });

  it("finds a commit dated before the last fetch but pushed after it", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { refresh } = await importedMonday(state);
    // Committed five days before Monday's fetch, pushed after it.
    state.branch.push(mine("late", "2026-08-27T09:00:00.000Z"));
    const saved = await refresh(day(1, 10));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual(["a", "late"]);
  });

  it("falls back to a date listing after a force push, without losing or duplicating commits", async () => {
    const state: FakeRepo = {
      branch: [mine("base", day(1, 6)), mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    // "a" is amended into "a2" and pushed with a new commit on top.
    state.orphaned.push(state.branch.pop()!);
    state.branch.push(mine("a2", day(1, 9)), mine("b", day(1, 10)));
    const saved = await refresh(day(1, 11));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual(["a2", "b", "base"]);
    expect(saved.head).toBe("b");
    expect(github.kinds()).toMatchObject({ compare: 1, list: 1 });
    expect(github.calls.find((c) => c.includes("author=me"))).toContain(
      `since=${encodeURIComponent("2026-08-30T09:00:00.000Z")}`,
    );
    // The next refresh compares from the new head again.
    github.calls.length = 0;
    state.branch.push(mine("c", day(1, 12)));
    const next = await refresh(day(1, 13));
    expect(next.commits.map((c) => c.sha).sort()).toEqual([
      "a2",
      "b",
      "base",
      "c",
    ]);
    expect(github.kinds()).toMatchObject({ compare: 1, list: 0, detail: 1 });
  });

  it("falls back when the stored head no longer exists at all", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    state.branch = [mine("a2", day(1, 8)), mine("b", day(1, 10))];
    const saved = await refresh(day(1, 11));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual(["a2", "b"]);
    expect(saved.head).toBe("b");
    expect(github.kinds()).toMatchObject({ compare: 1, list: 1 });
  });

  it("falls back to a date listing when GitHub returns fewer compared commits than it counts", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
      compareCap: 1,
    };
    const { github, refresh } = await importedMonday(state);
    state.branch.push(mine("b", day(1, 9)), mine("c", day(1, 10)));
    const saved = await refresh(day(1, 11));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual(["a", "b", "c"]);
    expect(github.kinds()).toMatchObject({ compare: 1, list: 1 });
  });

  it("refreshes a snapshot saved before heads were stored from its own last fetch", async () => {
    const state: FakeRepo = {
      branch: [mine("a", day(1, 8))],
      orphaned: [],
      prs: [],
    };
    const { github, refresh } = await importedMonday(state);
    const legacy = store.snapshot("me/app")!;
    delete legacy.head;
    store.save(legacy);
    state.branch.push(mine("b", day(3)));
    state.prs.push({ number: 7, mergedAt: day(2) });
    const saved = await refresh(day(5));
    expect(saved.commits.map((c) => c.sha).sort()).toEqual(["a", "b"]);
    expect(saved.prs.map((p) => p.number)).toEqual([7]);
    expect(saved.head).toBe("b");
    // From its own last fetch, Monday 09:00, less the two-day margin.
    expect(github.calls.find((c) => c.includes("author=me"))).toContain(
      `since=${encodeURIComponent("2026-08-30T09:00:00.000Z")}`,
    );
    github.calls.length = 0;
    await refresh(day(5, 10));
    expect(github.kinds()).toMatchObject({ list: 0, compare: 0, detail: 0 });
  });
});

describe("background refresh across repositories", () => {
  it("keeps a failed repository's state and resumes it from its own last success", async () => {
    process.env.HQ_DATABASE = join(
      mkdtempSync(join(tmpdir(), "hq-refresh-")),
      "activity.sqlite",
    );
    process.env.GITHUB_TOKEN = "test-only";
    const shared = getStore();
    const now = Date.now();
    const at = (hoursAgo: number) =>
      new Date(now - hoursAgo * 3_600_000).toISOString();
    const repos: Record<string, FakeRepo> = {
      "me/a": { branch: [mine("a1", at(100))], orphaned: [], prs: [] },
      "me/b": { branch: [mine("b1", at(100))], orphaned: [], prs: [] },
    };
    for (const name of ["me/a", "me/b"])
      shared.save({
        repo: { ...repo, fullName: name },
        commits: [{ ...commit(`${name.at(-1)}1`, at(100)), languages: {} }],
        prs: [],
        since: at(200),
        until: at(72),
        importedAt: at(72),
        head: `${name.at(-1)}1`,
      });
    shared.assertAccount("me");
    fakeGithub(GithubClient.prototype, repos);
    const settle = () =>
      vi.waitFor(() =>
        expect(shared.dataset().status.state).not.toBe("running"),
      );

    repos["me/a"]!.branch.push(mine("a2", at(50)));
    repos["me/b"]!.branch.push(mine("b2", at(50)));
    repos["me/b"]!.prs.push({ number: 9, mergedAt: at(40) });
    repos["me/b"]!.fail = true;
    expect(await startRefresh()).toEqual({ ok: true });
    await settle();
    const a = shared.snapshot("me/a")!;
    const b = shared.snapshot("me/b")!;
    expect(a.head).toBe("a2");
    expect(a.until > at(1)).toBe(true);
    expect(b).toMatchObject({ head: "b1", until: at(72) });
    expect(shared.sync()["me/b"]?.state).toBe("error");

    repos["me/b"]!.fail = false;
    expect(await startRefresh()).toEqual({ ok: true });
    await settle();
    const resumed = shared.snapshot("me/b")!;
    expect(resumed.commits.map((c) => c.sha).sort()).toEqual(["b1", "b2"]);
    expect(resumed.prs.map((p) => p.number)).toEqual([9]);
    expect(resumed.head).toBe("b2");
    // The dataset cache is cleared by each save, so readers see the refresh.
    expect(
      shared.dataset().snapshots.find((s) => s.repo.fullName === "me/b")?.head,
    ).toBe("b2");
    shared.close();
    delete process.env.GITHUB_TOKEN;
  });
});

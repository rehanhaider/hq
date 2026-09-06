import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityStore } from "./db";
import { GithubClient } from "./github";
import { importRepository } from "./import";

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

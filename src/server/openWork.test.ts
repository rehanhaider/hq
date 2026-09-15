import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityStore } from "./db";

let store: ActivityStore;
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getStore: () => store };
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A GitHub that answers every sweep request, counting how many arrive. */
function fakeGithub() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/user")) return json({ login: "me", id: 1 });
      if (url.includes("/user/orgs")) return json([]);
      if (url.includes("/user/repos")) return json([]);
      if (url.includes("/search/issues")) return json({ items: [] });
      throw new Error(`unexpected ${url}`);
    }),
  );
  return calls;
}

beforeEach(() => {
  store = new ActivityStore(":memory:");
  vi.stubEnv("GITHUB_TOKEN", "test-only");
  vi.resetModules();
});
afterEach(() => {
  if (store?.db.isOpen) store.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("openWork feed", () => {
  it("sweeps live when nothing is cached, then saves the result", async () => {
    const calls = fakeGithub();
    const { openWork } = await import("./openWork");
    const feed = await openWork();
    expect(feed.connected).toBe(true);
    expect(calls.some((url) => url.includes("/search/issues"))).toBe(true);
    expect(store.read("openWork")).toMatchObject({ login: "me" });
  });

  it("serves a saved copy at once and refreshes it behind the page", async () => {
    const saved = {
      connected: true,
      login: "me",
      mine: [],
      triage: [],
      everything: [],
      fetchedAt: new Date(Date.now() - 60 * 60000).toISOString(),
    };
    store.write("openWork", saved);
    const calls = fakeGithub();
    const { openWork } = await import("./openWork");
    const feed = await openWork();
    expect(feed.fetchedAt).toBe(saved.fetchedAt);
    // The background sweep has started even though the page did not wait.
    await vi.waitFor(() =>
      expect(calls.some((url) => url.includes("/search/issues"))).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        (store.read<{ fetchedAt: string }>("openWork") ?? saved).fetchedAt,
      ).not.toBe(saved.fetchedAt),
    );
  });

  it("does not sweep again while the copy is fresh", async () => {
    store.write("openWork", {
      connected: true,
      login: "me",
      mine: [],
      triage: [],
      everything: [],
      fetchedAt: new Date().toISOString(),
    });
    const calls = fakeGithub();
    const { openWork, warmOpenWork } = await import("./openWork");
    await openWork();
    warmOpenWork();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ActivityStore } from "./db";
import type { Snapshot } from "../lib/model";

let store: ActivityStore;
afterEach(() => store?.close());
const snapshot: Snapshot = {
  repo: {
    id: 1,
    fullName: "me/app",
    private: false,
    language: null,
    defaultBranch: "main",
    pushedAt: null,
  },
  commits: [],
  prs: [],
  since: "2026-08-01T00:00:00.000Z",
  until: "2026-09-01T00:00:00.000Z",
  importedAt: "2026-09-01T00:00:00.000Z",
};
describe("SQLite storage", () => {
  it("replaces a repository snapshot without duplicating it or changing unrelated repositories", () => {
    store = new ActivityStore(":memory:");
    store.save(snapshot);
    store.save({
      ...snapshot,
      repo: { ...snapshot.repo, id: 2, fullName: "me/other" },
    });
    store.save({ ...snapshot, since: "2026-08-15T00:00:00.000Z" });
    expect(store.dataset().snapshots).toHaveLength(2);
    expect(store.snapshot("me/app")?.since).toBe("2026-08-15T00:00:00.000Z");
    expect(store.snapshot("me/other")?.since).toBe(snapshot.since);
  });
  it("prevents mixing accounts and preserves the original identity", () => {
    store = new ActivityStore(":memory:");
    store.assertAccount("me");
    store.assertAccount("ME");
    expect(() => store.assertAccount("another")).toThrow("belongs to @ME");
    expect(store.dataset().login).toBe("ME");
  });
  it("records per-repository sync state", () => {
    store = new ActivityStore(":memory:");
    store.setSync("me/app", { state: "ok", lastSuccessAt: snapshot.importedAt });
    expect(store.sync()["me/app"]?.state).toBe("ok");
    store.setSync("me/app", {
      state: "error",
      error: "unavailable",
      lastAttemptAt: "2026-09-07T13:00:00.000Z",
    });
    expect(store.sync()["me/app"]).toMatchObject({
      state: "error",
      error: "unavailable",
      lastSuccessAt: snapshot.importedAt,
    });
  });
  it("removes a repository snapshot and its sync record", () => {
    store = new ActivityStore(":memory:");
    store.save(snapshot);
    store.save({
      ...snapshot,
      repo: { ...snapshot.repo, id: 2, fullName: "me/other" },
    });
    store.setSync("me/app", { state: "ok" });
    store.remove("me/app");
    expect(store.snapshot("me/app")).toBeNull();
    expect(store.sync()["me/app"]).toBeUndefined();
    expect(store.snapshot("me/other")).toBeTruthy();
  });
});

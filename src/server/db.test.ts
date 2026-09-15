import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityStore } from "./db";
import type { ImportStatus, Snapshot } from "../lib/model";

let store: ActivityStore;
let dir: string | null = null;
afterEach(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
/** A store that can be closed and reopened, as a restart would. */
function onDisk() {
  dir = mkdtempSync(join(tmpdir(), "hq-db-"));
  return join(dir, "activity.sqlite");
}
const running: ImportStatus = {
  state: "running",
  message: "Reading me/app…",
  completed: 3,
  total: 9,
  startedAt: "2026-09-15T10:09:53.923Z",
  finishedAt: null,
};
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
  it("reports a manual import cut off by a restart as an error", () => {
    const path = onDisk();
    store = new ActivityStore(path);
    store.setStatus({ ...running, mode: "manual" });
    store.setSync("me/app", { state: "syncing", lastSuccessAt: null });
    store.close();
    store = new ActivityStore(path);
    expect(store.dataset().status).toMatchObject({
      state: "error",
      message: expect.stringContaining("stopped during import"),
      finishedAt: expect.any(String),
    });
    expect(store.sync()["me/app"]).toMatchObject({
      state: "error",
      error: "The app stopped while fetching this repository.",
    });
  });
  it("lets a background refresh cut off by a restart resume quietly", () => {
    const path = onDisk();
    store = new ActivityStore(path);
    store.setStatus({ ...running, mode: "refresh" });
    store.setSync("me/app", {
      state: "syncing",
      lastSuccessAt: snapshot.importedAt,
    });
    store.setSync("me/new", { state: "syncing", lastSuccessAt: null });
    store.close();
    store = new ActivityStore(path);
    // Idle hides the banner; a null finishedAt lets the next tick re-run.
    expect(store.dataset().status).toMatchObject({
      state: "idle",
      mode: "refresh",
      finishedAt: null,
    });
    expect(store.sync()["me/app"]).toMatchObject({ state: "ok", error: null });
    expect(store.sync()["me/new"]).toMatchObject({ state: "idle", error: null });
  });
  it("treats a running row from before modes were recorded as a manual import", () => {
    const path = onDisk();
    store = new ActivityStore(path);
    store.setStatus(running);
    store.close();
    store = new ActivityStore(path);
    expect(store.dataset().status.state).toBe("error");
  });
});

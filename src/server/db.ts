import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Dataset, ImportStatus, RepoSync, Snapshot } from "../lib/model";

export const idleStatus: ImportStatus = {
  state: "idle",
  message: "Add repositories in Projects.",
  completed: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
};
export class ActivityStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (repo TEXT PRIMARY KEY, payload TEXT NOT NULL);",
    );
    const status = this.read<ImportStatus>("status");
    if (status?.state === "running") {
      const refresh = status.mode === "refresh";
      // A background refresh cut off by a restart lost nothing: each
      // repository is saved as it finishes and the next run re-reads the
      // same 48-hour window. Leaving finishedAt empty lets that run start
      // on the next tick instead of after the usual quarter-hour wait, and
      // there is no error to show. A manual import is the user's own run,
      // so its interruption is still reported.
      this.setStatus(
        refresh
          ? {
              ...status,
              state: "idle",
              message: "Refresh interrupted by a restart. It resumes shortly.",
              finishedAt: null,
            }
          : {
              ...status,
              state: "error",
              message:
                "The app stopped during import. Completed repositories are saved. Run the import again to finish.",
              finishedAt: new Date().toISOString(),
            },
      );
      const sync = this.sync();
      for (const row of Object.values(sync)) {
        if (row.state !== "syncing") continue;
        if (refresh)
          this.setSync(row.fullName, {
            state: row.lastSuccessAt ? "ok" : "idle",
            error: null,
          });
        else
          this.setSync(row.fullName, {
            state: "error",
            error: "The app stopped while fetching this repository.",
            lastAttemptAt: new Date().toISOString(),
          });
      }
    }
  }
  sync(): Record<string, RepoSync> {
    return this.read<Record<string, RepoSync>>("sync") ?? {};
  }
  setSync(repo: string, patch: Partial<RepoSync>) {
    const all = this.sync();
    const previous = all[repo] ?? {
      fullName: repo,
      state: "idle" as const,
      error: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
    };
    all[repo] = { ...previous, ...patch, fullName: repo };
    this.write("sync", all);
  }
  read<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }
  write(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  setStatus(status: ImportStatus) {
    this.write("status", status);
  }
  assertAccount(login: string) {
    const existing = this.read<string>("login");
    if (existing && existing.toLowerCase() !== login.toLowerCase())
      throw new Error(
        `This database belongs to @${existing}. Start the app with that account's token.`,
      );
    this.write("login", login);
  }
  save(snapshot: Snapshot) {
    this.db
      .prepare(
        "INSERT INTO snapshots VALUES (?, ?) ON CONFLICT(repo) DO UPDATE SET payload=excluded.payload",
      )
      .run(snapshot.repo.fullName, JSON.stringify(snapshot));
  }
  snapshot(repo: string): Snapshot | null {
    const row = this.db
      .prepare("SELECT payload FROM snapshots WHERE repo = ?")
      .get(repo) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Snapshot) : null;
  }
  remove(repo: string) {
    this.db.prepare("DELETE FROM snapshots WHERE repo = ?").run(repo);
    const all = this.sync();
    delete all[repo];
    this.write("sync", all);
  }
  dataset(): Dataset {
    const rows = this.db
      .prepare("SELECT payload FROM snapshots ORDER BY repo")
      .all() as { payload: string }[];
    return {
      login: this.read<string>("login"),
      snapshots: rows.map((row) => JSON.parse(row.payload) as Snapshot),
      status: this.read<ImportStatus>("status") ?? idleStatus,
    };
  }
  close() {
    this.db.close();
  }
}
let store: ActivityStore | undefined;
export function getStore() {
  return (store ??= new ActivityStore(
    resolve(process.env.HQ_DATABASE ?? "data/activity.sqlite"),
  ));
}

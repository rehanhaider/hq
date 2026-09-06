import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Dataset, ImportStatus, Snapshot } from "../lib/model";

export const idleStatus: ImportStatus = {
  state: "idle",
  message: "Choose repositories to import your activity.",
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
    if (status?.state === "running")
      this.setStatus({
        ...status,
        state: "error",
        message:
          "The app stopped during import. Completed repositories are saved. Run the import again to finish.",
        finishedAt: new Date().toISOString(),
      });
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

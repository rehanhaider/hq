import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./backup.mjs", import.meta.url));
let dir;

const dataDir = () => join(dir, "data");
const backupDir = () => join(dir, "backups");
const listed = (label, tier) => {
  try {
    return readdirSync(join(backupDir(), label, tier)).sort();
  } catch {
    return [];
  }
};

function makeDb(path, table = "t") {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (a TEXT); INSERT INTO ${table} VALUES ('x');`);
  db.close();
}

function run(env = {}) {
  return execFileSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HQ_BACKUP_DIR: backupDir(), ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-backup-"));
  makeDb(join(dataDir(), "deen.sqlite"));
  makeDb(join(dataDir(), "activity.sqlite"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backup", () => {
  it("snapshots each database into its own directory", () => {
    run();
    expect(listed("deen", "daily")).toHaveLength(1);
    expect(listed("activity", "daily")).toHaveLength(1);
    expect(listed("deen", "weekly")).toHaveLength(1);
  });

  it("produces a readable copy of the data", () => {
    run();
    const file = listed("deen", "daily")[0];
    const db = new DatabaseSync(join(backupDir(), "deen", "daily", file), {
      readOnly: true,
    });
    expect(db.prepare("SELECT count(*) n FROM t").get().n).toBe(1);
    db.close();
  });

  it("backs up the configured path, not just the default directory", () => {
    // Regression: the script scanned data/ while the app read HQ_DEEN_DATABASE,
    // so a relocated database was never backed up and the run still succeeded.
    const moved = join(dir, "elsewhere", "deen.sqlite");
    makeDb(moved, "moved");
    rmSync(join(dataDir(), "deen.sqlite"));
    run({ HQ_DEEN_DATABASE: moved });
    const file = listed("deen", "daily")[0];
    expect(file).toBeDefined();
    const db = new DatabaseSync(join(backupDir(), "deen", "daily", file), {
      readOnly: true,
    });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get().name,
    ).toBe("moved");
    db.close();
  });

  it("keeps 7 daily copies", () => {
    for (let i = 0; i < 9; i++) run();
    expect(listed("deen", "daily")).toHaveLength(7);
    expect(listed("activity", "daily")).toHaveLength(7);
  });

  it("keeps 4 weekly copies", () => {
    for (let i = 0; i < 6; i++) run({ HQ_BACKUP_WEEKLY: "1" });
    expect(listed("deen", "weekly")).toHaveLength(4);
  });

  it("does not take a second weekly copy within the week", () => {
    run();
    run();
    expect(listed("deen", "weekly")).toHaveLength(1);
    expect(listed("deen", "daily")).toHaveLength(2);
  });

  it("does not let one database prune another with a shared prefix", () => {
    // Regression: pruning "foo" matched "foo-bar-<stamp>.sqlite" too.
    makeDb(join(dataDir(), "foo.sqlite"));
    makeDb(join(dataDir(), "foo-bar.sqlite"));
    for (let i = 0; i < 9; i++) run();
    expect(listed("foo", "daily")).toHaveLength(7);
    expect(listed("foo-bar", "daily")).toHaveLength(7);
  });

  it("retries a database whose weekly copy failed, despite a healthy sibling", () => {
    // Regression: weekly eligibility read the newest file of any name, so one
    // success suppressed every database's weekly attempt for seven days.
    run();
    rmSync(join(backupDir(), "activity", "weekly"), { recursive: true });
    run();
    expect(listed("activity", "weekly")).toHaveLength(1);
    expect(listed("deen", "weekly")).toHaveLength(1);
  });

  it("deletes a snapshot that fails validation and reports failure", () => {
    // Regression: a corrupt snapshot was left on disk, counting towards
    // retention and suppressing the next weekly run.
    const empty = join(dataDir(), "empty.sqlite");
    new DatabaseSync(empty).close(); // no tables
    let threw = false;
    try {
      run();
    } catch (error) {
      threw = true;
      expect(error.status).toBe(1);
      expect(String(error.stderr)).toContain("no tables");
    }
    expect(threw).toBe(true);
    expect(listed("empty", "daily")).toEqual([]);
    expect(listed("empty", "weekly")).toEqual([]);
    // A failure in one database must not stop the others.
    expect(listed("deen", "daily")).toHaveLength(1);
  });

  it("keeps every database when basenames collide across directories", () => {
    // Regression: the suffix loop grew `label` itself, so a duplicate exited on
    // a free name like foo-2-3 and then overwrote the entry holding foo-2 —
    // silently dropping a database from the run.
    const a = join(dir, "one", "deen.sqlite");
    const b = join(dir, "two", "deen.sqlite");
    makeDb(a, "one");
    makeDb(b, "two");
    rmSync(join(dataDir(), "deen.sqlite"));
    run({ HQ_DEEN_DATABASE: a, HQ_BACKUP_DATA: join(dir, "two") });
    expect(listed("deen", "daily")).toHaveLength(1);
    expect(listed("deen-2", "daily")).toHaveLength(1);
    const tables = ["deen", "deen-2"].map((label) => {
      const db = new DatabaseSync(
        join(backupDir(), label, "daily", listed(label, "daily")[0]),
        { readOnly: true },
      );
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get().name;
      db.close();
      return t;
    });
    expect(tables.sort()).toEqual(["one", "two"]);
  });

  it("fails loudly when there is nothing to back up", () => {
    rmSync(dataDir(), { recursive: true });
    expect(() => run()).toThrow();
  });

  it("ignores non-database files", () => {
    writeFileSync(join(dataDir(), "notes.txt"), "hello");
    run();
    expect(listed("notes", "daily")).toEqual([]);
  });
});

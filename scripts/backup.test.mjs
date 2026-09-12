import { execFileSync, spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./backup.mjs", import.meta.url));
let dir;

const dataDir = () => join(dir, "data");
const backupDir = () => join(dir, "backups");
// Only finished snapshots: a staged .tmp is deliberately not one.
const listed = (label, tier) => {
  try {
    return readdirSync(join(backupDir(), label, tier))
      .filter((f) => f.endsWith(".sqlite"))
      .sort();
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

  it("backs up Content when its configured path is outside the other database directories", () => {
    const content = join(dir, "content-volume", "content.sqlite");
    makeDb(content, "pages");
    run({ HQ_CONTENT_DATABASE: content });
    const file = listed("content", "daily")[0];
    expect(file).toBeDefined();
    const db = new DatabaseSync(join(backupDir(), "content", "daily", file), {
      readOnly: true,
    });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get().name,
    ).toBe("pages");
    db.close();
  });

  it("still follows the deprecated Notes variable", () => {
    const legacy = join(dir, "legacy-volume", "content.sqlite");
    makeDb(legacy, "pages");
    run({ HQ_NOTES_DATABASE: legacy });
    expect(listed("content", "daily")[0]).toBeDefined();
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

  it("refuses an ambiguous configuration instead of inventing names", () => {
    // A backup directory is named after its database, so two databases sharing
    // a filename would share a directory and prune each other. Guessing a
    // distinct name is what previously dropped a database from a run and let
    // one steal another's history, so this is refused before anything is
    // written rather than worked around.
    const a = join(dir, "one", "deen.sqlite");
    const b = join(dir, "two", "deen.sqlite");
    makeDb(a, "one");
    makeDb(b, "two");
    rmSync(join(dataDir(), "deen.sqlite"));

    let failure;
    try {
      run({ HQ_DEEN_DATABASE: a, HQ_BACKUP_DATA: join(dir, "two") });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(failure.status).toBe(1);
    const stderr = String(failure.stderr);
    expect(stderr).toContain('Two databases are both named "deen"');
    expect(stderr).toContain(a);
    expect(stderr).toContain(b);
    // The lock file is created first; what matters is that no snapshot was.
    const written = existsSync(backupDir())
      ? readdirSync(backupDir()).filter((f) => f !== ".lock")
      : [];
    expect(written).toEqual([]);
  });

  // flock(1) is util-linux; the script degrades to running unlocked without it.
  const onLinux = it.runIf(process.platform === "linux");
  const lockPath = () => join(backupDir(), ".lock");

  onLinux("skips while another process holds the lock", () => {
    // Exclusion is now the kernel's, so this holds a real flock rather than
    // forging lock-file contents.
    mkdirSync(backupDir(), { recursive: true });
    const holder = spawn("flock", ["--nonblock", lockPath(), "sleep", "10"], {
      stdio: "ignore",
    });
    try {
      // Wait until the lock is genuinely held before contending for it.
      const held = () => {
        const probe = spawnSync("flock", ["--nonblock", lockPath(), "true"]);
        return probe.status !== 0;
      };
      const deadline = Date.now() + 5000;
      while (!held() && Date.now() < deadline) {}
      expect(held()).toBe(true);

      const out = run();
      expect(out).toContain("Another backup run is in progress");
      expect(listed("deen", "daily")).toEqual([]);
    } finally {
      holder.kill();
    }
  });

  onLinux("is not blocked by a lock file left behind by a dead run", () => {
    // The kernel drops a flock when its holder dies, so there is no stale lock
    // to detect or recover — the leftover file is inert.
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(lockPath(), "");
    run();
    expect(listed("deen", "daily")).toHaveLength(1);
  });

  it("clears a partial snapshot left by a run that died mid-write", () => {
    // Regression: a kill or power cut during VACUUM INTO left a partial file
    // already named .sqlite, which counted towards retention and whose mtime
    // read as a successful weekly snapshot. Snapshots are now staged as .tmp
    // and renamed only after validation.
    run();
    const weeklyDir = join(backupDir(), "deen", "weekly");
    const partial = join(weeklyDir, "deen-20260101-000000.sqlite.tmp");
    writeFileSync(partial, "");
    expect(listed("deen", "weekly")).toHaveLength(1); // .tmp is not counted
    run({ HQ_BACKUP_WEEKLY: "1" });
    expect(existsSync(partial)).toBe(false); // and it is swept away
    expect(listed("deen", "weekly")).toHaveLength(2);
  });

  it("takes the weekly copy on the seventh day despite timer jitter", () => {
    // Regression: a strict 168-hour threshold plus RandomizedDelaySec=300 meant
    // a run seven days after a late one fell minutes short, giving 8-day gaps.
    run();
    expect(listed("deen", "weekly")).toHaveLength(1);
    const weekly = join(backupDir(), "deen", "weekly", listed("deen", "weekly")[0]);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    // Last minute of the day seven calendar days ago: always under 168 hours.
    const when = new Date(midnight.getTime() - 7 * 86_400_000 + 86_340_000);
    expect(Date.now() - when.getTime()).toBeLessThan(7 * 86_400_000);
    utimesSync(weekly, when, when);
    run();
    expect(listed("deen", "weekly")).toHaveLength(2);
  });

  it("fails when an explicitly configured database is missing", () => {
    // Regression: a configured path that did not exist was silently dropped, so
    // the other database was backed up, the run exited 0, and the timer would
    // report healthy runs forever while an absent mount went unsnapshotted.
    const absent = join(dir, "not-mounted", "deen.sqlite");
    rmSync(join(dataDir(), "deen.sqlite"));

    let failure;
    try {
      run({ HQ_DEEN_DATABASE: absent });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(failure.status).toBe(1);
    expect(String(failure.stderr)).toContain("HQ_DEEN_DATABASE");
    expect(String(failure.stderr)).toContain(absent);
    // The database that is present is still backed up.
    expect(listed("activity", "daily")).toHaveLength(1);
  });

  it("does not fail when a default path simply does not exist yet", () => {
    // Only an explicitly configured path is required; a default that has not
    // been created yet is ordinary on a fresh install.
    rmSync(join(dataDir(), "activity.sqlite"));
    run();
    expect(listed("deen", "daily")).toHaveLength(1);
    expect(listed("activity", "daily")).toEqual([]);
  });

  it("fails loudly when there is nothing to back up", () => {
    rmSync(dataDir(), { recursive: true });
    expect(() => run()).toThrow();
  });

  it("ignores non-database files", () => {
    writeFileSync(join(dataDir(), "content.txt"), "hello");
    run();
    expect(listed("content", "daily")).toEqual([]);
  });
});

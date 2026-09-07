#!/usr/bin/env node
// Snapshots every HQ database into backups/<name>/daily, and once a week into
// backups/<name>/weekly as well. Retention is by count: 7 daily, 4 weekly.
//
// VACUUM INTO is used rather than a file copy. A plain `cp` of a WAL-mode
// database captures only the main file, silently omitting everything still in
// the -wal — that is how Nasr's old timer ended up a week stale. VACUUM INTO
// runs inside a read transaction and writes a fully checkpointed, consistent
// database, so it is safe against a running app and needs no downtime.
//
// Each database gets its own directory. Retention and weekly scheduling are
// then scoped by directory rather than by filename prefix, so one database can
// neither prune nor suppress the backups of another.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = process.env.HQ_BACKUP_DIR ?? join(root, "backups");

const KEEP = { daily: 7, weekly: 4 };

const shortHash = (value) =>
  createHash("sha1").update(value).digest("hex").slice(0, 8);

/**
 * Serialises runs. Two processes — the timer and a manual invocation — would
 * otherwise both find the weekly tier due, both write a snapshot, and burn two
 * of the four weekly slots on the same day; their prunes would race too.
 * Returns null when another live run holds the lock. A lock left behind by a
 * killed run is detected by its pid and taken over.
 */
function acquireLock() {
  const path = join(backupDir, ".lock");
  mkdirSync(backupDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder = 0;
      try {
        holder = Number(readFileSync(path, "utf8").trim());
      } catch {
        // The holder released it between our open and this read; retry.
      }
      if (holder && alive(holder)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // running, just not ours to signal
  }
}

// Whole days since the epoch, in local time, matching how stamp() names files.
function calendarDay(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * Resolves the databases the app actually opens.
 *
 * `src/server/deen.ts` and `src/server/db.ts` read HQ_DEEN_DATABASE and
 * HQ_DATABASE, so a scan of `data/` alone would back up whatever happened to
 * be left in the default location while the live databases went untouched —
 * and still report success. Both units set the same WorkingDirectory, so
 * resolving relative paths the way the app does keeps the two in step.
 *
 * Any other .sqlite alongside them is picked up too, so a database added later
 * is not silently left out.
 */
function sources() {
  const configured = [
    resolve(process.env.HQ_DEEN_DATABASE ?? "data/deen.sqlite"),
    resolve(process.env.HQ_DATABASE ?? "data/activity.sqlite"),
  ];
  const found = new Set(configured.filter((path) => existsSync(path)));
  const dirs = new Set(configured.map((path) => dirname(path)));
  if (process.env.HQ_BACKUP_DATA) dirs.add(resolve(process.env.HQ_BACKUP_DATA));
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".sqlite")) found.add(join(dir, entry));
    }
  }

  // Two databases in different directories can share a basename, which would
  // otherwise put both in one backup directory and let each prune the other.
  const paths = [...found].sort();
  const seen = new Map();
  for (const path of paths) {
    const base = basename(path, ".sqlite");
    seen.set(base, (seen.get(base) ?? 0) + 1);
  }

  // A counter would number the duplicates by discovery order, so adding a
  // database whose path sorts earlier would hand it the label of an existing
  // one — its snapshots would land in that database's directory and prune the
  // history there. Deriving the suffix from the directory instead makes a
  // label depend only on the database's own path.
  const byLabel = new Map();
  for (const path of paths) {
    const base = basename(path, ".sqlite");
    const label =
      seen.get(base) === 1 ? base : `${base}-${shortHash(dirname(path))}`;
    byLabel.set(label, path);
  }
  return byLabel;
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

const tierDir = (label, tier) => join(backupDir, label, tier);

function snapshots(label, tier) {
  try {
    return readdirSync(tierDir(label, tier))
      .filter((f) => f.endsWith(".sqlite"))
      .sort();
  } catch {
    return [];
  }
}

// Keeps the newest `keep` backups, deleting older ones. Pruning by count
// rather than age means a long gap in runs cannot wipe every copy.
function prune(label, tier, keep) {
  const dir = tierDir(label, tier);
  for (const stale of snapshots(label, tier).reverse().slice(keep)) {
    rmSync(join(dir, stale));
    console.log(`  pruned ${label}/${tier}/${stale}`);
  }
}

/**
 * The weekly tier gives four weeks of reach beyond the seven daily copies. It
 * triggers on age rather than on a fixed weekday: a Pi that is off on Sunday
 * would otherwise skip the week entirely and quietly let the weekly tier age
 * out. Eligibility is per database, so a database whose weekly snapshot failed
 * is retried on the next run instead of being suppressed by a sibling that
 * succeeded. HQ_BACKUP_WEEKLY forces it, for testing and for a deliberate
 * snapshot.
 */
function weeklyIsDue(label, now) {
  if (process.env.HQ_BACKUP_WEEKLY === "1") return true;
  const dir = tierDir(label, "weekly");
  let newest = 0;
  for (const file of snapshots(label, "weekly")) {
    newest = Math.max(newest, statSync(join(dir, file)).mtimeMs);
  }
  if (!newest) return true;
  // Calendar days, not a strict 168 hours: the timer adds up to five minutes of
  // jitter, so the run seven days after a late one can land minutes short of the
  // hour threshold and push the weekly copy out to an eight-day interval.
  return calendarDay(now.getTime()) - calendarDay(newest) >= 7;
}

function snapshot(sourcePath, label, tier, at) {
  const dir = tierDir(label, tier);
  mkdirSync(dir, { recursive: true });

  // VACUUM INTO refuses to overwrite. Two runs inside the same second — a
  // manual run next to the timer, or a Persistent catch-up — would otherwise
  // fail the unit, so give the second one its own suffix.
  let name = stamp(at);
  for (let n = 2; existsSync(join(dir, `${label}-${name}.sqlite`)); n++) {
    name = `${stamp(at)}-${n}`;
  }
  const target = join(dir, `${label}-${name}.sqlite`);

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }

  // A backup nobody has opened is a guess, not a backup. Verify before pruning
  // anything, so a corrupt write can never displace a good copy — and delete a
  // failed snapshot, or it would count towards retention and, in the weekly
  // tier, suppress the next week's attempt.
  try {
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      const verdict = check.prepare("PRAGMA integrity_check").get()
        ?.integrity_check;
      if (verdict !== "ok") throw new Error(`integrity_check said "${verdict}"`);
      const tables = check
        .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
        .get().n;
      if (!tables) throw new Error("backup contains no tables");
    } finally {
      check.close();
    }
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }

  const size = statSync(target).size;
  console.log(
    `  ${label}/${tier}/${basename(target)} (${size.toLocaleString()} bytes, integrity ok)`,
  );
  prune(label, tier, KEEP[tier]);
}

const now = new Date();
const found = sources();

if (!found.size) {
  console.error("No HQ databases found; nothing to back up.");
  process.exit(1);
}

const release = acquireLock();
if (!release) {
  // Not a failure: the run that holds the lock is doing the same work.
  console.log("Another backup run is in progress; skipping.");
  process.exit(0);
}

let failed = 0;
try {
  for (const [label, path] of found) {
    const tiers = weeklyIsDue(label, now) ? ["daily", "weekly"] : ["daily"];
    console.log(`${label} <- ${path} (${tiers.join(", ")})`);
    for (const tier of tiers) {
      try {
        snapshot(path, label, tier, now);
      } catch (error) {
        failed++;
        console.error(`  FAILED ${label}/${tier}: ${error.message}`);
      }
    }
  }
} finally {
  release();
}

process.exit(failed ? 1 : 0);

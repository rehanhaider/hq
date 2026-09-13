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
//
// The Content pages link to uploaded images, videos, and files, which live in a
// directory rather than in SQLite. They are copied under the same tiers and the
// same retention, because a page whose pictures are missing is only half a
// restore.

import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = process.env.HQ_BACKUP_DIR ?? join(root, "backups");

const KEEP = { daily: 7, weekly: 4 };

// Reserved: media copies live under backups/uploads/, so a database of that
// name would share the directory and mix retention with the file snapshots.
const UPLOADS_LABEL = "uploads";

const LOCK_CONFLICT = 75;

/**
 * Runs the real work under a kernel advisory lock, by re-executing this script
 * inside flock(1).
 *
 * A lock file guarded by hand cannot be made airtight: judging a lock stale and
 * then removing it is a check followed by an act, and the file can be replaced
 * in between, so a recovering process can delete a lock another has just
 * legitimately acquired. Three rounds of review found a different instance of
 * that same shape. flock has no staleness to recover from — the kernel drops
 * the lock when the holder dies — so the class of bug does not exist.
 *
 * Re-executing, rather than putting flock in the unit, keeps the guarantee
 * however the script is invoked: an ad-hoc `node scripts/backup.mjs` alongside
 * the timer is exactly the overlap the lock is for.
 *
 * Returns an exit code for the parent, or null if this process should do the
 * work itself — either because it is already inside the lock, or because flock
 * is unavailable and running unlocked beats not running.
 */
function runUnderFlock() {
  if (process.env.HQ_BACKUP_LOCKED === "1") return null;
  mkdirSync(backupDir, { recursive: true });
  const result = spawnSync(
    "flock",
    [
      "--nonblock",
      `--conflict-exit-code=${LOCK_CONFLICT}`,
      join(backupDir, ".lock"),
      process.execPath,
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, HQ_BACKUP_LOCKED: "1" },
    },
  );
  if (result.error?.code === "ENOENT") {
    console.error("flock is unavailable; running without a lock.");
    return null;
  }
  if (result.error) throw result.error;
  if (result.status === LOCK_CONFLICT) {
    // Not a failure: the run holding the lock is doing the same work.
    console.log("Another backup run is in progress; skipping.");
    return 0;
  }
  return result.status ?? 1;
}

// Whole days since the epoch, in local time, matching how stamp() names files.
function calendarDay(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * Resolves the databases the app actually opens.
 *
 * The server stores read HQ_DEEN_DATABASE, HQ_DATABASE, and HQ_CONTENT_DATABASE,
 * so a scan of `data/` alone would back up whatever happened to
 * be left in the default location while the live databases went untouched —
 * and still report success. Both units set the same WorkingDirectory, so
 * resolving relative paths the way the app does keeps the two in step.
 *
 * Any other .sqlite alongside them is picked up too, so a database added later
 * is not silently left out.
 */
function sources() {
  const configured = [
    { vars: ["HQ_DEEN_DATABASE"], fallback: "data/deen.sqlite" },
    { vars: ["HQ_DATABASE"], fallback: "data/activity.sqlite" },
    // HQ_NOTES_DATABASE is the name Content had before it was renamed. It is
    // still read here, or a Pi that never updated its env file would have its
    // pages quietly left out of every backup.
    { vars: ["HQ_CONTENT_DATABASE", "HQ_NOTES_DATABASE"], fallback: "data/content.sqlite" },
  ].map(({ vars, fallback }) => {
    const named = vars.find((name) => process.env[name]);
    return {
      env: named ?? vars[0],
      explicit: Boolean(named),
      path: resolve(named ? process.env[named] : fallback),
    };
  });

  // A path named explicitly must exist. Skipping it would back up the other
  // database, exit 0, and let the timer report healthy runs indefinitely while
  // the named one — an absent external mount, say — was never snapshotted. A
  // missing *default* is not an error: it just has not been created yet.
  const missing = configured.filter((c) => c.explicit && !existsSync(c.path));

  const found = new Set(
    configured.filter((c) => existsSync(c.path)).map((c) => c.path),
  );
  const dirs = new Set(configured.map((c) => dirname(c.path)));
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

  // A backup directory is named after its database, so two databases sharing a
  // filename would share a directory and prune each other's history. Inventing
  // a distinct name for them is guesswork, and the guessing is what produced
  // silent data loss twice: a dropped database, and one stealing another's
  // history. An ambiguous configuration is refused instead, loudly and before
  // anything is written. The uploads label is reserved the same way: media
  // copies live under it, and sharing it would mix retention and weekly
  // eligibility with a database of that name.
  const byLabel = new Map();
  for (const path of [...found].sort()) {
    const label = basename(path, ".sqlite");
    const clash = byLabel.get(label);
    if (clash) {
      throw new Error(
        `Two databases are both named "${label}":\n  ${clash}\n  ${path}\n` +
          "Rename one, or move it out of the directories being scanned.",
      );
    }
    byLabel.set(label, path);
  }
  const reserved = byLabel.get(UPLOADS_LABEL);
  if (reserved) {
    throw new Error(
      `A database is named "${UPLOADS_LABEL}":\n  ${reserved}\n` +
        "That name is reserved for Content's uploaded files. Rename the database, or move it out of the directories being scanned.",
    );
  }
  return { byLabel, missing };
}

/**
 * The uploaded files the Content pages point at. HQ_UPLOADS_DIR moves them the
 * way the database variables move a database, and, like those, a directory
 * named explicitly must exist: silently skipping it would report healthy runs
 * while every image went unsaved. A missing default has simply not been written
 * to yet.
 */
function uploadsSource() {
  // Blank is unset, matching the database variables: HQ_UPLOADS_DIR= in an
  // env file is not a path, and resolve("") is the working directory.
  const named = process.env.HQ_UPLOADS_DIR?.trim();
  const path = resolve(named || "data/uploads");
  if (named && !existsSync(path))
    return { path, missing: { env: "HQ_UPLOADS_DIR", path } };
  return { path: existsSync(path) ? path : null, missing: null };
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

const tierDir = (label, tier) => join(backupDir, label, tier);

// A finished snapshot: a verified database, or a complete copy of the uploads
// directory. A staged .tmp is deliberately neither.
const isSnapshot = (label, name) =>
  label === UPLOADS_LABEL
    ? name.startsWith(`${UPLOADS_LABEL}-`) && !name.endsWith(".tmp")
    : name.endsWith(".sqlite");

function snapshots(label, tier) {
  try {
    return readdirSync(tierDir(label, tier))
      .filter((name) => isSnapshot(label, name))
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
    rmSync(join(dir, stale), { recursive: true, force: true });
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

  // Write under a name nothing counts, and only take the .sqlite name once the
  // copy has been verified. A kill or a power cut mid-VACUUM would otherwise
  // leave a partial file already wearing the real extension: retention would
  // count it, and its mtime would read as a successful weekly snapshot and
  // suppress the next one. The rename is atomic within the directory, so a
  // .sqlite here is always a file that passed validation.
  const staged = `${target}.tmp`;
  // Runs are serialised by the lock, so any .tmp already here is a leftover
  // from a run that died mid-write. Nothing counts it, but nothing would ever
  // remove it either.
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".sqlite.tmp")) rmSync(join(dir, file), { force: true });
  }

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(staged);
  } finally {
    db.close();
  }

  // A backup nobody has opened is a guess, not a backup. Verify before the
  // rename, so only a file that passed validation ever takes the .sqlite name.
  try {
    const check = new DatabaseSync(staged, { readOnly: true });
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
    rmSync(staged, { force: true });
    throw error;
  }

  renameSync(staged, target);

  const size = statSync(target).size;
  console.log(
    `  ${label}/${tier}/${basename(target)} (${size.toLocaleString()} bytes, integrity ok)`,
  );
  prune(label, tier, KEEP[tier]);
}

/**
 * Copies the uploads directory whole. Staged under a name nothing counts and
 * renamed into place, for the same reason the databases are: a copy interrupted
 * halfway must not be mistaken for a complete one.
 */
function snapshotUploads(source, tier, at) {
  const dir = tierDir(UPLOADS_LABEL, tier);
  mkdirSync(dir, { recursive: true });

  let name = stamp(at);
  for (let n = 2; existsSync(join(dir, `${UPLOADS_LABEL}-${name}`)); n++) {
    name = `${stamp(at)}-${n}`;
  }
  const target = join(dir, `${UPLOADS_LABEL}-${name}`);
  const staged = `${target}.tmp`;

  for (const file of readdirSync(dir)) {
    if (file.endsWith(".tmp")) rmSync(join(dir, file), { recursive: true, force: true });
  }

  try {
    cpSync(source, staged, { recursive: true });
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
  renameSync(staged, target);

  const count = readdirSync(target).length;
  console.log(`  ${UPLOADS_LABEL}/${tier}/${basename(target)} (${count} file${count === 1 ? "" : "s"})`);
  prune(UPLOADS_LABEL, tier, KEEP[tier]);
}

const relayed = runUnderFlock();
if (relayed !== null) process.exit(relayed);

const now = new Date();
let byLabel;
let missing;
try {
  ({ byLabel, missing } = sources());
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

let failed = 0;
// Reported even when nothing else can be done, so the run says why it failed.
for (const { env, path } of missing) {
  failed++;
  console.error(`FAILED ${env}: ${path} does not exist`);
}

if (!byLabel.size) {
  if (!failed) console.error("No HQ databases found; nothing to back up.");
  process.exit(1);
}


for (const [label, path] of byLabel) {
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

const media = uploadsSource();
if (media.missing) {
  failed++;
  console.error(`FAILED ${media.missing.env}: ${media.missing.path} does not exist`);
} else if (media.path) {
  const tiers = weeklyIsDue(UPLOADS_LABEL, now) ? ["daily", "weekly"] : ["daily"];
  console.log(`${UPLOADS_LABEL} <- ${media.path} (${tiers.join(", ")})`);
  for (const tier of tiers) {
    try {
      snapshotUploads(media.path, tier, now);
    } catch (error) {
      failed++;
      console.error(`  FAILED ${UPLOADS_LABEL}/${tier}: ${error.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);

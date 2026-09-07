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
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = process.env.HQ_BACKUP_DIR ?? join(root, "backups");

const KEEP = { daily: 7, weekly: 4 };

/**
 * Identity of a lock holder. A bare pid is not enough: the lock file outlives a
 * reboot while pid allocation restarts, so a long-lived process inheriting the
 * number would look alive forever and silently suppress every backup while the
 * unit still reported success. The boot id catches the reboot case and the
 * process start time catches reuse within one boot.
 */
function self() {
  return { pid: process.pid, boot: bootId(), start: startTime(process.pid) };
}

function bootId() {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return null; // not Linux; fall back to the pid check alone
  }
}

function startTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Skip past the comm field, which may itself contain spaces and brackets.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function heldBy(holder) {
  if (!holder?.pid) return false;
  const boot = bootId();
  if (holder.boot && boot && holder.boot !== boot) return false; // earlier boot
  if (!alive(holder.pid)) return false;
  const start = startTime(holder.pid);
  if (holder.start && start && holder.start !== start) return false; // pid reused
  return true;
}

/**
 * Serialises runs. Two processes — the timer and a manual invocation — would
 * otherwise both find the weekly tier due, both write a snapshot, and burn two
 * of the four weekly slots on the same day; their prunes would race too.
 * Returns null when another live run holds the lock; a lock left behind by a
 * killed run, or by a previous boot, is taken over.
 */
function acquireLock() {
  const path = join(backupDir, ".lock");
  mkdirSync(backupDir, { recursive: true });
  const mine = JSON.stringify(self());
  const staging = `${path}.${process.pid}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    // Fill the file before it is visible under the lock name. Creating it with
    // "wx" and writing afterwards leaves a window where a contender reads an
    // empty file, fails to parse it, and concludes the lock is stale. link()
    // publishes a complete file and fails with EEXIST if one already exists.
    rmSync(staging, { force: true });
    writeFileSync(staging, mine);
    try {
      linkSync(staging, path);
      rmSync(staging, { force: true });
      // A contender that judged this lock stale a moment ago may still unlink
      // it and put its own in place. Reading back what is actually there
      // settles who owns it, and the loser backs off rather than running too.
      try {
        if (readFileSync(path, "utf8") !== mine) return null;
      } catch {
        return null;
      }
      return () => {
        try {
          if (readFileSync(path, "utf8") === mine) rmSync(path, { force: true });
        } catch {
          // Already gone, or taken over; either way not ours to remove.
        }
      };
    } catch (error) {
      rmSync(staging, { force: true });
      if (error.code !== "EEXIST") throw error;
    }

    let holder = null;
    try {
      holder = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Released between our link and this read, or written by an older
      // version that stored a bare pid. Retry rather than assume.
      continue;
    }
    if (heldBy(holder)) return null;

    // Take the stale lock away by renaming it, which is atomic: of two
    // processes recovering the same stale lock exactly one rename succeeds and
    // the other gets ENOENT. A stat-then-unlink pair cannot promise that — the
    // file can be replaced in between, and the unlink would then destroy a
    // lock someone else had legitimately acquired.
    try {
      const taken = `${path}.stale.${process.pid}`;
      renameSync(path, taken);
      rmSync(taken, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Another process cleared it first; loop round and contend for the claim.
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
    { env: "HQ_DEEN_DATABASE", fallback: "data/deen.sqlite" },
    { env: "HQ_DATABASE", fallback: "data/activity.sqlite" },
  ].map(({ env, fallback }) => ({
    env,
    explicit: Boolean(process.env[env]),
    path: resolve(process.env[env] ?? fallback),
  }));

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
  // anything is written.
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
  return { byLabel, missing };
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
// Reported before the lock, so a run that can do nothing else still says why.
for (const { env, path } of missing) {
  failed++;
  console.error(`FAILED ${env}: ${path} does not exist`);
}

if (!byLabel.size) {
  if (!failed) console.error("No HQ databases found; nothing to back up.");
  process.exit(1);
}

const release = acquireLock();
if (!release) {
  // Not a failure: the run that holds the lock is doing the same work.
  console.log("Another backup run is in progress; skipping.");
  process.exit(0);
}

try {
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
} finally {
  release();
}

process.exit(failed ? 1 : 0);

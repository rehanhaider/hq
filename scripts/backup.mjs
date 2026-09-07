#!/usr/bin/env node
// Snapshots every HQ database into backups/daily, and once a week into
// backups/weekly as well. Retention is by count: 7 daily, 4 weekly.
//
// VACUUM INTO is used rather than a file copy. A plain `cp` of a WAL-mode
// database captures only the main file, silently omitting everything still in
// the -wal — that is how Nasr's old timer ended up a week stale. VACUUM INTO
// runs inside a read transaction and writes a fully checkpointed, consistent
// database, so it is safe against a running app and needs no downtime.

import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.HQ_BACKUP_DATA ?? join(root, "data");
const backupDir = process.env.HQ_BACKUP_DIR ?? join(root, "backups");

const KEEP = { daily: 7, weekly: 4 };

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// Keeps the newest `keep` backups of `name`, deleting older ones. Pruning by
// count rather than age means a long gap in runs cannot wipe every copy.
function prune(tier, name, keep) {
  const dir = join(backupDir, tier);
  const existing = readdirSync(dir)
    .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".sqlite"))
    .sort()
    .reverse();
  for (const stale of existing.slice(keep)) {
    rmSync(join(dir, stale));
    console.log(`  pruned ${tier}/${stale}`);
  }
}

function snapshot(sourcePath, name, tier, at) {
  const dir = join(backupDir, tier);
  mkdirSync(dir, { recursive: true });

  // VACUUM INTO refuses to overwrite. Two runs inside the same second — a
  // manual run next to the timer, or a Persistent catch-up — would otherwise
  // fail the unit, so give the second one its own suffix.
  let label = stamp(at);
  for (let n = 2; existsSync(join(dir, `${name}-${label}.sqlite`)); n++) {
    label = `${stamp(at)}-${n}`;
  }
  const target = join(dir, `${name}-${label}.sqlite`);

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }

  // A backup nobody has opened is a guess, not a backup. Verify before pruning
  // anything, so a corrupt write can never displace a good copy.
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    const result = check.prepare("PRAGMA integrity_check").get();
    const verdict = result?.integrity_check;
    if (verdict !== "ok") throw new Error(`integrity_check failed: ${verdict}`);
    const tables = check
      .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
      .get().n;
    if (!tables) throw new Error("backup contains no tables");
  } finally {
    check.close();
  }

  const size = statSync(target).size;
  console.log(`  ${tier}/${name}-${label}.sqlite (${size.toLocaleString()} bytes, integrity ok)`);
  prune(tier, name, KEEP[tier]);
}

const now = new Date();
const sources = readdirSync(dataDir)
  .filter((f) => f.endsWith(".sqlite"))
  .sort();

if (!sources.length) {
  console.error(`No .sqlite files in ${dataDir}; nothing to back up.`);
  process.exit(1);
}

// The weekly tier gives four weeks of reach beyond the seven daily copies. It
// triggers on age rather than on a fixed weekday: a Pi that is off on Sunday
// would otherwise skip the week entirely and quietly let the weekly tier age
// out. HQ_BACKUP_WEEKLY forces it, for testing and for a deliberate snapshot.
function weeklyIsDue() {
  if (process.env.HQ_BACKUP_WEEKLY === "1") return true;
  const dir = join(backupDir, "weekly");
  let newest = 0;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".sqlite")) continue;
      newest = Math.max(newest, statSync(join(dir, file)).mtimeMs);
    }
  } catch {
    return true; // no weekly directory yet
  }
  return now.getTime() - newest >= 7 * 24 * 60 * 60 * 1000;
}

const tiers = weeklyIsDue() ? ["daily", "weekly"] : ["daily"];
console.log(`HQ backup ${now.toISOString()} -> ${tiers.join(", ")}`);

let failed = 0;
for (const file of sources) {
  const name = file.replace(/\.sqlite$/, "");
  for (const tier of tiers) {
    try {
      snapshot(join(dataDir, file), name, tier, now);
    } catch (error) {
      failed++;
      console.error(`  FAILED ${tier}/${name}: ${error.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);

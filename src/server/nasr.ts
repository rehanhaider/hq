import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ADHKAR_KEYS,
  adhkarItemIds,
  emptyDay,
  type AdhkarKey,
  type NasrAdhkarTick,
  type NasrDay,
  type NasrDayUpdate,
  type Observation,
  type ObservationCreate,
  type ResetResponse,
  type Settings,
  type SettingsUpdate,
} from "../lib/nasr";

const schema = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS nasr_days (
  date TEXT PRIMARY KEY,
  fajr TEXT,
  dhuhr TEXT,
  asr TEXT,
  maghrib TEXT,
  isha TEXT,
  morning_adhkar INTEGER NOT NULL DEFAULT 0,
  evening_adhkar INTEGER NOT NULL DEFAULT 0,
  night_ayat_kursi INTEGER NOT NULL DEFAULT 0,
  night_baqarah INTEGER NOT NULL DEFAULT 0,
  night_three_suras INTEGER NOT NULL DEFAULT 0,
  ruqyah INTEGER NOT NULL DEFAULT 0,
  istighfar_count INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS nasr_adhkar_ticks (
  date TEXT NOT NULL,
  practice TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (date, item_id)
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  text TEXT NOT NULL
);
`;

type DayRow = {
  date: string;
  fajr: string | null;
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
  isha: string | null;
  morning_adhkar: number;
  evening_adhkar: number;
  night_ayat_kursi: number;
  night_baqarah: number;
  night_three_suras: number;
  ruqyah: number;
  istighfar_count: number;
  note: string | null;
};

// Nasr measures a rolling 40-day window, so there is no cycle start date to
// read. A `cycle_start_date` row left by an older version stays in the file,
// unread, rather than being deleted out from under a backup.
const SETTING_KEYS = ["timezone", "istighfar_target"] as const;

function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function prayer(value: unknown): NasrDay["fajr"] {
  return value === "ontime" || value === "qada" || value === "missed"
    ? value
    : null;
}

function normalizeDay(row: DayRow | NasrDay, stored: Set<string>): NasrDay {
  return {
    date: row.date,
    fajr: prayer(row.fajr),
    dhuhr: prayer(row.dhuhr),
    asr: prayer(row.asr),
    maghrib: prayer(row.maghrib),
    isha: prayer(row.isha),
    morning_adhkar: asBool(row.morning_adhkar),
    evening_adhkar: asBool(row.evening_adhkar),
    night_ayat_kursi: asBool(row.night_ayat_kursi),
    night_baqarah: asBool(row.night_baqarah),
    night_three_suras: asBool(row.night_three_suras),
    ruqyah: asBool(row.ruqyah),
    // Days logged before item ticks existed still show every item as done.
    adhkar_ticks: ADHKAR_KEYS.flatMap((key) =>
      adhkarItemIds(key).filter((id) => asBool(row[key]) || stored.has(id)),
    ),
    istighfar_count: row.istighfar_count ?? 0,
    note: row.note ?? null,
  };
}

export class NasrStore {
  readonly db: DatabaseSync;
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(schema);
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  setting(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }
  setSetting(key: string, value: string | null) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  settings(): Settings {
    return {
      timezone: this.setting("timezone") ?? "Asia/Kolkata",
      istighfar_target: parseInt(this.setting("istighfar_target") ?? "100", 10),
    };
  }
  updateSettings(updates: SettingsUpdate): Settings {
    for (const key of SETTING_KEYS) {
      if (key in updates && updates[key] !== undefined) {
        const value = updates[key];
        this.setSetting(key, value === null ? null : String(value));
      }
    }
    return this.settings();
  }
  days(): NasrDay[] {
    const rows = this.db
      .prepare("SELECT * FROM nasr_days ORDER BY date")
      .all() as DayRow[];
    const ticks = this.db
      .prepare("SELECT date, item_id FROM nasr_adhkar_ticks")
      .all() as { date: string; item_id: string }[];
    const stored = new Map<string, Set<string>>();
    for (const tick of ticks) {
      const ids = stored.get(tick.date) ?? new Set<string>();
      ids.add(tick.item_id);
      stored.set(tick.date, ids);
    }
    return rows.map((row) =>
      normalizeDay(row, stored.get(row.date) ?? new Set<string>()),
    );
  }
  day(date: string): NasrDay {
    const row = this.db
      .prepare("SELECT * FROM nasr_days WHERE date = ?")
      .get(date) as DayRow | undefined;
    const ticks = this.db
      .prepare("SELECT item_id FROM nasr_adhkar_ticks WHERE date = ?")
      .all(date) as { item_id: string }[];
    return normalizeDay(
      row ?? emptyDay(date),
      new Set(ticks.map((tick) => tick.item_id)),
    );
  }
  upsertDay(data: NasrDayUpdate): NasrDay {
    return this.transaction(() => {
      const existing = this.day(data.date);
      const pick = <T>(next: T | undefined, prev: T): T =>
        next !== undefined ? next : prev;
      const merged: NasrDay = {
        date: data.date,
        fajr: pick(data.fajr, existing.fajr),
        dhuhr: pick(data.dhuhr, existing.dhuhr),
        asr: pick(data.asr, existing.asr),
        maghrib: pick(data.maghrib, existing.maghrib),
        isha: pick(data.isha, existing.isha),
        morning_adhkar: pick(data.morning_adhkar, existing.morning_adhkar),
        evening_adhkar: pick(data.evening_adhkar, existing.evening_adhkar),
        night_ayat_kursi: pick(data.night_ayat_kursi, existing.night_ayat_kursi),
        night_baqarah: pick(data.night_baqarah, existing.night_baqarah),
        night_three_suras: pick(
          data.night_three_suras,
          existing.night_three_suras,
        ),
        ruqyah: pick(data.ruqyah, existing.ruqyah),
        adhkar_ticks: existing.adhkar_ticks,
        istighfar_count: pick(data.istighfar_count, existing.istighfar_count),
        note: pick(data.note, existing.note),
      };
      this.writeDay(merged);
      for (const key of ADHKAR_KEYS) {
        if (data[key] !== undefined) {
          this.writeAdhkarTicks(
            data.date,
            key,
            data[key] ? adhkarItemIds(key) : [],
          );
        }
      }
      return this.day(data.date);
    });
  }
  private writeDay(day: NasrDay) {
    this.db
      .prepare(
        `INSERT INTO nasr_days (
          date, fajr, dhuhr, asr, maghrib, isha,
          morning_adhkar, evening_adhkar, night_ayat_kursi, night_baqarah,
          night_three_suras, ruqyah, istighfar_count, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          fajr=excluded.fajr, dhuhr=excluded.dhuhr, asr=excluded.asr,
          maghrib=excluded.maghrib, isha=excluded.isha,
          morning_adhkar=excluded.morning_adhkar,
          evening_adhkar=excluded.evening_adhkar,
          night_ayat_kursi=excluded.night_ayat_kursi,
          night_baqarah=excluded.night_baqarah,
          night_three_suras=excluded.night_three_suras,
          ruqyah=excluded.ruqyah, istighfar_count=excluded.istighfar_count,
          note=excluded.note`,
      )
      .run(
        day.date,
        day.fajr,
        day.dhuhr,
        day.asr,
        day.maghrib,
        day.isha,
        day.morning_adhkar ? 1 : 0,
        day.evening_adhkar ? 1 : 0,
        day.night_ayat_kursi ? 1 : 0,
        day.night_baqarah ? 1 : 0,
        day.night_three_suras ? 1 : 0,
        day.ruqyah ? 1 : 0,
        day.istighfar_count,
        day.note,
      );
  }
  private writeAdhkarTicks(date: string, key: AdhkarKey, ids: string[]) {
    this.db
      .prepare("DELETE FROM nasr_adhkar_ticks WHERE date = ? AND practice = ?")
      .run(date, key);
    const insert = this.db.prepare(
      "INSERT INTO nasr_adhkar_ticks (date, practice, item_id) VALUES (?, ?, ?)",
    );
    for (const id of ids) insert.run(date, key, id);
  }
  setAdhkarItem(data: NasrAdhkarTick): NasrDay {
    const key = ADHKAR_KEYS.find((key) =>
      adhkarItemIds(key).includes(data.item_id),
    );
    if (!key) throw new Error(`Unknown adhkar item: ${data.item_id}`);
    return this.transaction(() => {
      const existing = this.day(data.date);
      const ids = adhkarItemIds(key);
      const ticks = new Set(
        existing.adhkar_ticks.filter((id) => ids.includes(id)),
      );
      if (data.done) ticks.add(data.item_id);
      else ticks.delete(data.item_id);
      this.writeAdhkarTicks(data.date, key, [...ticks]);
      this.writeDay({ ...existing, [key]: ids.every((id) => ticks.has(id)) });
      return this.day(data.date);
    });
  }
  observations(): Observation[] {
    return this.db
      .prepare("SELECT * FROM observations ORDER BY timestamp DESC")
      .all() as Observation[];
  }
  createObservation(data: ObservationCreate): Observation {
    const observation = {
      id: randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      text: data.text,
    };
    this.db
      .prepare("INSERT INTO observations VALUES (?, ?, ?)")
      .run(observation.id, observation.timestamp, observation.text);
    return observation;
  }
  deleteObservation(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM observations WHERE id = ?")
      .run(id);
    return Number(result.changes) > 0;
  }
  exportJson() {
    return {
      exported_at: new Date().toISOString(),
      settings: this.db.prepare("SELECT * FROM settings").all(),
      nasr_days: this.days(),
      observations: this.observations(),
    };
  }
  exportCsv(): string {
    const headers = [
      "date",
      "fajr",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
      "morning_adhkar",
      "evening_adhkar",
      "night_ayat_kursi",
      "night_baqarah",
      "night_three_suras",
      "ruqyah",
      "istighfar_count",
      "note",
    ];
    const rows = this.days().map((day) =>
      headers
        .map((header) => csvEscape(String(day[header as keyof NasrDay] ?? "")))
        .join(","),
    );
    return [headers.join(","), ...rows].join("\n");
  }
  reset(): ResetResponse {
    const dir = join(
      dirname(this.path === ":memory:" ? "data/nasr.sqlite" : this.path),
      "..",
      "backups",
    );
    mkdirSync(dir, { recursive: true });
    const backupPath = freeBackupPath(dir);
    if (this.path !== ":memory:") {
      this.db.prepare("VACUUM INTO ?").run(backupPath);
    }
    const deleted: Record<string, number> = {};
    for (const table of [
      "observations",
      "nasr_adhkar_ticks",
      "nasr_days",
    ] as const) {
      deleted[table] = Number(
        this.db.prepare(`DELETE FROM ${table}`).run().changes,
      );
    }
    return { backup_path: backupPath, deleted };
  }
  close() {
    this.db.close();
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");
}

function freeBackupPath(dir: string): string {
  const base = join(dir, `pre-reset-${timestamp()}`);
  if (!existsSync(`${base}.db`)) return `${base}.db`;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}.db`;
    if (!existsSync(candidate)) return candidate;
  }
}

let store: NasrStore | undefined;
export function nasrPath() {
  return resolve(process.env.HQ_NASR_DATABASE ?? "data/nasr.sqlite");
}
export function getNasrStore() {
  return (store ??= new NasrStore(nasrPath()));
}

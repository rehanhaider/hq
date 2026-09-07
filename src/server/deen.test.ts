import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DeenStore } from "./deen";

let store: DeenStore;
afterEach(() => store?.close());

describe("deen store", () => {
  it("leaves untouched fields alone and can clear a prayer", () => {
    store = new DeenStore(":memory:");
    store.upsertDay({ date: "2026-01-01", fajr: "ontime", ruqyah: true });
    const merged = store.upsertDay({ date: "2026-01-01", dhuhr: "qada" });
    expect(merged.fajr).toBe("ontime");
    expect(merged.dhuhr).toBe("qada");
    expect(merged.ruqyah).toBe(true);
    const cleared = store.upsertDay({ date: "2026-01-01", fajr: null });
    expect(cleared.fajr).toBeNull();
  });
  it("imports days, notes, and cycle settings from a Nasr database once", () => {
    const root = join(tmpdir(), `hq-nasr-import-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const nasrPath = join(root, "nasr.db");
    const source = new DatabaseSync(nasrPath);
    source.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE deen_days (
        date TEXT PRIMARY KEY, fajr TEXT, dhuhr TEXT, asr TEXT, maghrib TEXT, isha TEXT,
        morning_adhkar INTEGER, evening_adhkar INTEGER, night_ayat_kursi INTEGER,
        night_baqarah INTEGER, night_three_suras INTEGER, ruqyah INTEGER,
        istighfar_count INTEGER, note TEXT
      );
      CREATE TABLE observations (id TEXT PRIMARY KEY, timestamp TEXT, text TEXT);
      CREATE TABLE sadaqah_log (id TEXT PRIMARY KEY, date TEXT, note TEXT, amount INTEGER);
      INSERT INTO sadaqah_log VALUES ('old-entry', '2026-08-02', 'legacy entry', 10);
      INSERT INTO settings VALUES ('timezone', 'Asia/Kolkata');
      INSERT INTO settings VALUES ('cycle_start_date', '2026-08-01');
      INSERT INTO settings VALUES ('istighfar_target', '100');
      INSERT INTO settings VALUES ('pin_hash', 'skip-me');
      INSERT INTO deen_days (date, fajr, ruqyah, istighfar_count) VALUES ('2026-08-02', 'ontime', 1, 33);
      INSERT INTO observations VALUES ('obs-1', '2026-08-02T10:00:00.000Z', 'kept');
    `);
    source.close();
    store = new DeenStore(":memory:");
    expect(store.importNasr(nasrPath)).toBe(true);
    expect(store.day("2026-08-02").fajr).toBe("ontime");
    expect(store.day("2026-08-02").ruqyah).toBe(true);
    expect(store.settings().cycle_start_date).toBe("2026-08-01");
    expect(store.observations()).toHaveLength(1);
    expect(
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'sadaqah_log'")
        .get(),
    ).toBeUndefined();
    expect(store.exportJson()).not.toHaveProperty("sadaqah_log");
    expect(store.setting("pin_hash")).toBeNull();
    expect(store.setting("imported_from")).toBe(nasrPath);
    expect(store.importNasr(nasrPath)).toBe(true);
    expect(store.days()).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });
});

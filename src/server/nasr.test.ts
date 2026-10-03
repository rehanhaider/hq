import { afterEach, describe, expect, it } from "vitest";
import { adhkarItemIds } from "../lib/nasr";
import { NasrStore } from "./nasr";

let store: NasrStore;
afterEach(() => store?.close());

describe("nasr store", () => {
  it("leaves untouched fields alone and can clear a prayer", () => {
    store = new NasrStore(":memory:");
    store.upsertDay({ date: "2026-01-01", fajr: "ontime", ruqyah: true });
    const merged = store.upsertDay({ date: "2026-01-01", dhuhr: "qada" });
    expect(merged.fajr).toBe("ontime");
    expect(merged.dhuhr).toBe("qada");
    expect(merged.ruqyah).toBe(true);
    const cleared = store.upsertDay({ date: "2026-01-01", fajr: null });
    expect(cleared.fajr).toBeNull();
  });
  it("ticks one morning item without completing either practice", () => {
    store = new NasrStore(":memory:");
    const id = adhkarItemIds("morning_adhkar")[0]!;
    const day = store.setAdhkarItem({
      date: "2026-01-01",
      item_id: id,
      done: true,
    });
    expect(day.adhkar_ticks).toEqual([id]);
    expect(day.morning_adhkar).toBe(false);
    expect(day.evening_adhkar).toBe(false);
  });
  it("completes morning adhkar and preserves the other ticks when unticking", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("morning_adhkar");
    expect(ids).toHaveLength(11);
    for (const id of ids) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true });
    }
    expect(store.day("2026-01-01").morning_adhkar).toBe(true);
    expect(store.day("2026-01-01").adhkar_ticks).toEqual(ids);
    const day = store.setAdhkarItem({
      date: "2026-01-01",
      item_id: ids[0]!,
      done: false,
    });
    expect(day.adhkar_ticks).toEqual(ids.slice(1));
    expect(day.morning_adhkar).toBe(false);
  });
  it("ticks all morning items from the row and clears partial progress", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("morning_adhkar");
    const complete = store.upsertDay({
      date: "2026-01-01",
      morning_adhkar: true,
    });
    expect(complete.adhkar_ticks).toEqual(ids);
    expect(complete.morning_adhkar).toBe(true);
    expect(complete.evening_adhkar).toBe(false);
    for (const id of ids.slice(3)) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: false });
    }
    expect(store.day("2026-01-01").adhkar_ticks).toEqual(ids.slice(0, 3));
    const cleared = store.upsertDay({
      date: "2026-01-01",
      morning_adhkar: false,
    });
    expect(cleared.adhkar_ticks).toEqual([]);
    expect(cleared.morning_adhkar).toBe(false);
  });
  it("preserves partial morning ticks when logging a prayer", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("morning_adhkar").slice(0, 3);
    for (const id of ids) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true });
    }
    const day = store.upsertDay({ date: "2026-01-01", fajr: "ontime" });
    expect(day.fajr).toBe("ontime");
    expect(day.adhkar_ticks).toEqual(ids);
    expect(day.morning_adhkar).toBe(false);
  });
  it("expands a legacy completed day and can untick one item", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("morning_adhkar");
    store.db
      .prepare("INSERT INTO nasr_days (date, morning_adhkar) VALUES (?, 1)")
      .run("2026-01-01");
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM nasr_adhkar_ticks").get()
        ?.count,
    ).toBe(0);
    expect(store.day("2026-01-01").adhkar_ticks).toEqual(ids);
    const day = store.setAdhkarItem({
      date: "2026-01-01",
      item_id: ids[0]!,
      done: false,
    });
    expect(day.adhkar_ticks).toEqual(ids.slice(1));
    expect(day.morning_adhkar).toBe(false);
  });
  it("completes all evening items without completing morning adhkar", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("evening_adhkar");
    expect(ids).toHaveLength(12);
    for (const id of ids) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true });
    }
    const day = store.day("2026-01-01");
    expect(day.adhkar_ticks).toEqual(ids);
    expect(day.evening_adhkar).toBe(true);
    expect(day.morning_adhkar).toBe(false);
  });
  it("rejects unknown and non-adhkar items before writing anything", () => {
    store = new NasrStore(":memory:");
    for (const id of ["nope", "night-kursi"]) {
      expect(() =>
        store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true }),
      ).toThrow(`Unknown adhkar item: ${id}`);
      expect(
        store.db.prepare("SELECT COUNT(*) AS count FROM nasr_adhkar_ticks").get()
          ?.count,
      ).toBe(0);
      expect(store.days()).toEqual([]);
    }
  });
  it("returns each date's ticks in morning then evening guide order", () => {
    store = new NasrStore(":memory:");
    const morning = adhkarItemIds("morning_adhkar");
    const evening = adhkarItemIds("evening_adhkar");
    store.setAdhkarItem({
      date: "2026-01-01",
      item_id: evening[0]!,
      done: true,
    });
    for (const id of [morning[2]!, morning[0]!]) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true });
    }
    store.setAdhkarItem({
      date: "2026-01-02",
      item_id: evening[1]!,
      done: true,
    });
    expect(store.days().map((day) => [day.date, day.adhkar_ticks])).toEqual([
      ["2026-01-01", [morning[0], morning[2], evening[0]]],
      ["2026-01-02", [evening[1]]],
    ]);
  });
  it("counts and deletes adhkar ticks on reset", () => {
    store = new NasrStore(":memory:");
    const ids = [
      ...adhkarItemIds("morning_adhkar").slice(0, 2),
      adhkarItemIds("evening_adhkar")[0]!,
    ];
    for (const id of ids) {
      store.setAdhkarItem({ date: "2026-01-01", item_id: id, done: true });
    }
    const reset = store.reset();
    expect(reset.deleted.nasr_adhkar_ticks).toBe(3);
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM nasr_adhkar_ticks").get()
        ?.count,
    ).toBe(0);
    expect(store.day("2026-01-01").adhkar_ticks).toEqual([]);
  });
  it("keeps the CSV header and output unchanged by partial ticks", () => {
    store = new NasrStore(":memory:");
    store.upsertDay({ date: "2026-01-01", fajr: "ontime" });
    const before = store.exportCsv();
    store.setAdhkarItem({
      date: "2026-01-01",
      item_id: adhkarItemIds("morning_adhkar")[0]!,
      done: true,
    });
    expect(store.exportCsv().split("\n")[0]).toBe(
      "date,fajr,dhuhr,asr,maghrib,isha,morning_adhkar,evening_adhkar,night_ayat_kursi,night_baqarah,night_three_suras,ruqyah,istighfar_count,note",
    );
    expect(store.exportCsv()).toBe(before);
  });
  it("reads stored ticks without a day row and ignores removed guide ids", () => {
    store = new NasrStore(":memory:");
    const id = adhkarItemIds("morning_adhkar")[0]!;
    const insert = store.db.prepare(
      "INSERT INTO nasr_adhkar_ticks (date, practice, item_id) VALUES (?, ?, ?)",
    );
    insert.run("2026-01-01", "morning_adhkar", "removed-item");
    insert.run("2026-01-01", "morning_adhkar", id);
    expect(store.day("2026-01-01").adhkar_ticks).toEqual([id]);
    store.upsertDay({ date: "2026-01-01", fajr: "ontime" });
    expect(store.days()[0]!.adhkar_ticks).toEqual([id]);
  });
  it("rolls back a row update if writing its ticks fails", () => {
    store = new NasrStore(":memory:");
    const id = adhkarItemIds("morning_adhkar")[0]!;
    const existing = store.setAdhkarItem({
      date: "2026-01-01",
      item_id: id,
      done: true,
    });
    store.db.exec(`
      CREATE TRIGGER reject_ticks BEFORE INSERT ON nasr_adhkar_ticks
      BEGIN SELECT RAISE(ABORT, 'tick write failed'); END;
    `);
    expect(() =>
      store.upsertDay({ date: "2026-01-01", morning_adhkar: true }),
    ).toThrow("tick write failed");
    expect(store.day("2026-01-01")).toEqual(existing);
  });
  it("rolls back item ticks if writing the day fails", () => {
    store = new NasrStore(":memory:");
    const ids = adhkarItemIds("morning_adhkar");
    const existing = store.upsertDay({
      date: "2026-01-01",
      morning_adhkar: true,
    });
    store.db.exec(`
      CREATE TRIGGER reject_day BEFORE UPDATE ON nasr_days
      BEGIN SELECT RAISE(ABORT, 'day write failed'); END;
    `);
    expect(() =>
      store.setAdhkarItem({
        date: "2026-01-01",
        item_id: ids[0]!,
        done: false,
      }),
    ).toThrow("day write failed");
    expect(store.day("2026-01-01")).toEqual(existing);
  });
});

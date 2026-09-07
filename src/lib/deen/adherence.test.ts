import { describe, expect, it } from "vitest";
import {
  calculateAdherence,
  daysInCycleWindow,
  overallAdherence,
} from "./adherence";
import { emptyDay } from "./schemas";
import type { DeenDay } from "./schemas";

function makeDay(date: string, overrides: Partial<DeenDay> = {}): DeenDay {
  return { ...emptyDay(date), ...overrides };
}

describe("calculateAdherence", () => {
  it("returns 0% for empty days", () => {
    const result = calculateAdherence([], 10, 100);
    expect(result.fajr?.percentage).toBe(0);
    expect(result.fajr?.completed).toBe(0);
    expect(result.fajr?.total).toBe(10);
  });
  it("counts ontime and qada as completed for prayers", () => {
    const days = [
      makeDay("2025-01-01", { fajr: "ontime" }),
      makeDay("2025-01-02", { fajr: "qada" }),
      makeDay("2025-01-03", { fajr: "missed" }),
    ];
    const result = calculateAdherence(days, 5, 100);
    expect(result.fajr?.completed).toBe(2);
    expect(result.fajr?.percentage).toBe(40);
  });
  it("tracks fajr on-time separately", () => {
    const days = [
      makeDay("2025-01-01", { fajr: "ontime" }),
      makeDay("2025-01-02", { fajr: "qada" }),
    ];
    const result = calculateAdherence(days, 4, 100);
    expect(result.fajr_ontime?.completed).toBe(1);
    expect(result.fajr_ontime?.percentage).toBe(25);
  });
  it("tracks boolean items", () => {
    const days = [
      makeDay("2025-01-01", { morning_adhkar: true }),
      makeDay("2025-01-02", { morning_adhkar: true }),
      makeDay("2025-01-03", { morning_adhkar: false }),
    ];
    const result = calculateAdherence(days, 5, 100);
    expect(result.morning_adhkar?.completed).toBe(2);
    expect(result.morning_adhkar?.percentage).toBe(40);
  });
  it("tracks istighfar against target", () => {
    const days = [
      makeDay("2025-01-01", { istighfar_count: 100 }),
      makeDay("2025-01-02", { istighfar_count: 50 }),
      makeDay("2025-01-03", { istighfar_count: 150 }),
    ];
    const result = calculateAdherence(days, 5, 100);
    expect(result.istighfar?.completed).toBe(2);
    expect(result.istighfar?.percentage).toBe(40);
  });
  it("missed day lowers adherence but does not reset cycle", () => {
    const days = [
      makeDay("2025-01-01", {
        fajr: "ontime",
        dhuhr: "ontime",
        asr: "ontime",
        maghrib: "ontime",
        isha: "ontime",
      }),
      makeDay("2025-01-02", {
        fajr: "missed",
        dhuhr: "missed",
        asr: "missed",
        maghrib: "missed",
        isha: "missed",
      }),
      makeDay("2025-01-03", {
        fajr: "ontime",
        dhuhr: "ontime",
        asr: "ontime",
        maghrib: "ontime",
        isha: "ontime",
      }),
    ];
    const result = calculateAdherence(days, 3, 100);
    expect(result.fajr?.completed).toBe(2);
    expect(result.fajr?.percentage).toBe(67);
    expect(result.fajr?.total).toBe(3);
  });
});

describe("overallAdherence", () => {
  it("computes overall across all items", () => {
    const days = [
      makeDay("2025-01-01", {
        fajr: "ontime",
        dhuhr: "ontime",
        asr: "ontime",
        maghrib: "ontime",
        isha: "ontime",
        morning_adhkar: true,
        evening_adhkar: true,
        night_ayat_kursi: true,
        night_baqarah: true,
        night_three_suras: true,
        ruqyah: true,
        istighfar_count: 100,
      }),
    ];
    expect(overallAdherence(days, 1, 100).percentage).toBe(100);
  });
  it("returns 0 for no cycle days", () => {
    expect(overallAdherence([], 0, 100).percentage).toBe(0);
  });
});

describe("daysInCycleWindow", () => {
  const logged = ["2026-08-27", "2026-08-28", "2026-09-06", "2026-09-07"].map(
    (date) => makeDay(date, { fajr: "qada" }),
  );

  it("keeps a percentage at or below 100 when a cycle starts today", () => {
    // Regression: counting all history against a denominator of one cycle day
    // reported 1200% for twelve logged days.
    const windowed = daysInCycleWindow(logged, "2026-09-08", "2026-09-08");
    expect(windowed).toEqual([]);
    const result = calculateAdherence(windowed, 1, 100);
    expect(result.fajr!.percentage).toBe(0);
    expect(overallAdherence(windowed, 1, 100).percentage).toBe(0);
  });

  it("counts only days inside the cycle", () => {
    const windowed = daysInCycleWindow(logged, "2026-09-06", "2026-09-08");
    expect(windowed.map((d) => d.date)).toEqual(["2026-09-06", "2026-09-07"]);
    expect(calculateAdherence(windowed, 3, 100).fajr!.percentage).toBe(67);
  });

  it("stops at the fortieth day, not at today", () => {
    const days = [makeDay("2026-08-27"), makeDay("2026-10-20")];
    const windowed = daysInCycleWindow(days, "2026-08-27", "2026-12-01");
    expect(windowed.map((d) => d.date)).toEqual(["2026-08-27"]);
  });

  it("excludes days before the cycle starts", () => {
    const windowed = daysInCycleWindow(logged, "2026-09-01", "2026-09-08");
    expect(windowed.map((d) => d.date)).toEqual(["2026-09-06", "2026-09-07"]);
  });

  it("is empty while the cycle is still in the future", () => {
    expect(daysInCycleWindow(logged, "2026-10-01", "2026-09-08")).toEqual([]);
  });

  it("falls back to the trailing 40 days with no cycle set", () => {
    const days = [makeDay("2026-07-01"), ...logged];
    const windowed = daysInCycleWindow(days, null, "2026-09-08");
    expect(windowed.map((d) => d.date)).not.toContain("2026-07-01");
    expect(windowed).toHaveLength(4);
  });
});

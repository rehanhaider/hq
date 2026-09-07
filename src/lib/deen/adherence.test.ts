import { describe, expect, it } from "vitest";
import { calculateAdherence, overallAdherence } from "./adherence";
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

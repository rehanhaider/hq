import { describe, expect, it } from "vitest";
import {
  cycleDatesForDay,
  datesInRange,
  daysBetween,
  getCycleDay,
  isCycleComplete,
} from "./cycle";

describe("daysBetween", () => {
  it("returns 0 for same date", () => {
    expect(daysBetween("2025-01-01", "2025-01-01")).toBe(0);
  });
  it("returns positive for later end date", () => {
    expect(daysBetween("2025-01-01", "2025-01-10")).toBe(9);
  });
  it("returns negative for earlier end date", () => {
    expect(daysBetween("2025-01-10", "2025-01-01")).toBe(-9);
  });
  it("handles month boundaries", () => {
    expect(daysBetween("2025-01-30", "2025-02-02")).toBe(3);
  });
});

describe("getCycleDay", () => {
  it("returns null when no start date", () => {
    expect(getCycleDay(null, "2025-01-15")).toBeNull();
  });
  it("returns 1 on the start date", () => {
    expect(getCycleDay("2025-01-01", "2025-01-01")).toBe(1);
  });
  it("returns correct day mid-cycle", () => {
    expect(getCycleDay("2025-01-01", "2025-01-20")).toBe(20);
  });
  it("returns 40 on last day of cycle", () => {
    expect(getCycleDay("2025-01-01", "2025-02-09")).toBe(40);
  });
  it("returns 41 after cycle ends", () => {
    expect(getCycleDay("2025-01-01", "2025-02-10")).toBe(41);
  });
  it("returns null when today is before start", () => {
    expect(getCycleDay("2025-01-15", "2025-01-10")).toBeNull();
  });
});

describe("isCycleComplete", () => {
  it("returns false for null", () => {
    expect(isCycleComplete(null)).toBe(false);
  });
  it("returns false for day 40", () => {
    expect(isCycleComplete(40)).toBe(false);
  });
  it("returns true for day 41", () => {
    expect(isCycleComplete(41)).toBe(true);
  });
});

describe("datesInRange", () => {
  it("returns single date for same start/end", () => {
    expect(datesInRange("2025-01-01", "2025-01-01")).toEqual(["2025-01-01"]);
  });
  it("returns all dates in range", () => {
    expect(datesInRange("2025-01-01", "2025-01-03")).toEqual([
      "2025-01-01",
      "2025-01-02",
      "2025-01-03",
    ]);
  });
});

describe("cycleDatesForDay", () => {
  it("returns 40 dates for a 40-day cycle", () => {
    const dates = cycleDatesForDay("2025-01-01", 40);
    expect(dates).toHaveLength(40);
    expect(dates[0]).toBe("2025-01-01");
    expect(dates[39]).toBe("2025-02-09");
  });
});

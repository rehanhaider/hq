import { describe, expect, it } from "vitest";
import { datesInRange, middayPrayerLabel, shiftDate, windowDates } from "./dates";

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
  it("returns nothing for a reversed range", () => {
    expect(datesInRange("2025-01-03", "2025-01-01")).toEqual([]);
  });
});

describe("shiftDate", () => {
  it("moves across a month boundary", () => {
    expect(shiftDate("2025-02-02", -3)).toBe("2025-01-30");
    expect(shiftDate("2025-01-30", 3)).toBe("2025-02-02");
  });
});

describe("middayPrayerLabel", () => {
  it("names Friday midday Jumuah", () => {
    expect(middayPrayerLabel("2026-09-11")).toBe("Jumuah");
  });
  it("keeps Dhuhr on other weekdays", () => {
    expect(middayPrayerLabel("2026-09-14")).toBe("Dhuhr");
    expect(middayPrayerLabel("2026-09-10")).toBe("Dhuhr");
  });
});

describe("windowDates", () => {
  it("ends on today and holds 40 days", () => {
    const dates = windowDates("2025-02-09");
    expect(dates).toHaveLength(40);
    expect(dates[0]).toBe("2025-01-01");
    expect(dates.at(-1)).toBe("2025-02-09");
  });
  it("takes a shorter window", () => {
    expect(windowDates("2025-01-03", 3)).toEqual([
      "2025-01-01",
      "2025-01-02",
      "2025-01-03",
    ]);
  });
  it("crosses a year boundary", () => {
    expect(windowDates("2025-01-01", 2)).toEqual(["2024-12-31", "2025-01-01"]);
  });
});

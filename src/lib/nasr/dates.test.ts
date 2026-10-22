import { describe, expect, it } from "vitest";
import {
  datesInRange,
  dayOrToday,
  middayPrayerLabel,
  shiftDate,
  windowDates,
} from "./dates";
import { nasrTodaySearchSchema } from "./schemas";

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

describe("dayOrToday", () => {
  const today = "2026-10-21";
  it("shows the day asked for when it is before today", () => {
    expect(dayOrToday("2026-10-19", today)).toBe("2026-10-19");
  });
  it("reads no day, today, and a day after today as today", () => {
    expect(dayOrToday(undefined, today)).toBe(today);
    expect(dayOrToday(today, today)).toBe(today);
    expect(dayOrToday("2026-10-22", today)).toBe(today);
  });
});

describe("Today's search parameters", () => {
  it("keeps a calendar date and a known guide", () => {
    expect(
      nasrTodaySearchSchema.parse({ date: "2026-10-19", guide: "night" }),
    ).toEqual({ date: "2026-10-19", guide: "night" });
    expect(nasrTodaySearchSchema.parse({})).toEqual({});
  });
  it("drops a value that does not parse rather than failing the page", () => {
    expect(
      nasrTodaySearchSchema.parse({ date: "2026-02-30", guide: "night_ayat" }),
    ).toEqual({ date: undefined, guide: undefined });
    expect(
      nasrTodaySearchSchema.parse({ date: "19 October", guide: 3 }),
    ).toEqual({ date: undefined, guide: undefined });
  });
});

import { describe, expect, it } from "vitest";
import type { NasrDay } from "./schemas";
import { computeStreak, fajrOnTimeStreak, practiceStreaks } from "./streaks";
import { emptyDay } from "./schemas";

function makeDay(
  date: string,
  fajr: NasrDay["fajr"] = null,
): NasrDay {
  return { ...emptyDay(date), fajr };
}

describe("computeStreak", () => {
  it("returns 0/0 for empty days", () => {
    expect(computeStreak([], () => true, "2025-01-10")).toEqual({
      current: 0,
      longest: 0,
    });
  });
  it("computes current streak ending today", () => {
    const days = [
      makeDay("2025-01-08"),
      makeDay("2025-01-09"),
      makeDay("2025-01-10"),
    ];
    const result = computeStreak(days, () => true, "2025-01-10");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });
  it("current streak includes yesterday but not today yet", () => {
    const days = [makeDay("2025-01-08"), makeDay("2025-01-09")];
    expect(computeStreak(days, () => true, "2025-01-10").current).toBe(2);
  });
  it("current streak is 0 when last match is older than yesterday", () => {
    const days = [makeDay("2025-01-06"), makeDay("2025-01-07")];
    const result = computeStreak(days, () => true, "2025-01-10");
    expect(result.current).toBe(0);
    expect(result.longest).toBe(2);
  });
  it("handles gaps in streak", () => {
    const days = [
      makeDay("2025-01-01"),
      makeDay("2025-01-02"),
      makeDay("2025-01-04"),
      makeDay("2025-01-05"),
      makeDay("2025-01-06"),
    ];
    const result = computeStreak(days, () => true, "2025-01-06");
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });
  it("filters with predicate", () => {
    const days = [
      makeDay("2025-01-08", "ontime"),
      makeDay("2025-01-09", "missed"),
      makeDay("2025-01-10", "ontime"),
    ];
    const result = computeStreak(days, (d) => d.fajr === "ontime", "2025-01-10");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });
});

describe("fajrOnTimeStreak", () => {
  it("tracks on-time fajr specifically", () => {
    const days = [
      makeDay("2025-01-07", "ontime"),
      makeDay("2025-01-08", "ontime"),
      makeDay("2025-01-09", "qada"),
      makeDay("2025-01-10", "ontime"),
    ];
    const result = fajrOnTimeStreak(days, "2025-01-10");
    expect(result.current).toBe(1);
    expect(result.longest).toBe(2);
  });
  it("qada does not count for on-time streak", () => {
    const days = [makeDay("2025-01-09", "qada"), makeDay("2025-01-10", "qada")];
    expect(fajrOnTimeStreak(days, "2025-01-10").current).toBe(0);
  });
});

describe("practiceStreaks", () => {
  const adhkarDay = (
    date: string,
    values: Partial<Pick<NasrDay, "morning_adhkar" | "evening_adhkar" | "adhkar_ticks">>,
  ): NasrDay => ({ ...emptyDay(date), ...values });

  it("counts a set only on the days it was fully ticked", () => {
    const days = [
      adhkarDay("2025-01-08", { morning_adhkar: true }),
      adhkarDay("2025-01-09", { morning_adhkar: true, evening_adhkar: true }),
      // Some evening items ticked, not all, so the set is not complete.
      adhkarDay("2025-01-10", {
        morning_adhkar: true,
        adhkar_ticks: ["evening_adhkar-1", "evening_adhkar-2"],
      }),
    ];
    const streaks = practiceStreaks(days, "2025-01-10");
    expect(streaks.morning_adhkar).toEqual({ current: 3, longest: 3 });
    // The 10th is today and still open, so the 9th's streak stands.
    expect(streaks.evening_adhkar).toEqual({ current: 1, longest: 1 });
    // Once the 10th is over and unfinished, it breaks the streak.
    expect(practiceStreaks(days, "2025-01-11").evening_adhkar).toEqual({
      current: 0,
      longest: 1,
    });
  });
  it("keeps the best streak when a missed day resets the current one", () => {
    const days = [
      adhkarDay("2025-01-03", { evening_adhkar: true }),
      adhkarDay("2025-01-04", { evening_adhkar: true }),
      adhkarDay("2025-01-05", { evening_adhkar: true }),
      adhkarDay("2025-01-06", {}),
      adhkarDay("2025-01-07", { evening_adhkar: true }),
    ];
    expect(practiceStreaks(days, "2025-01-07").evening_adhkar).toEqual({
      current: 1,
      longest: 3,
    });
    // Nothing on the 8th, so on the 9th the current streak is gone.
    expect(practiceStreaks(days, "2025-01-09").evening_adhkar).toEqual({
      current: 0,
      longest: 3,
    });
  });
  it("gives each daily dua its own streak from its own tick", () => {
    const days = [
      adhkarDay("2025-01-09", { adhkar_ticks: ["dua-calamity"] }),
      adhkarDay("2025-01-10", { adhkar_ticks: ["dua-calamity"] }),
    ];
    const streaks = practiceStreaks(days, "2025-01-10");
    expect(streaks.duas).toEqual({
      "dua-calamity": { current: 2, longest: 2 },
    });
    expect(practiceStreaks([], "2025-01-10").duas).toEqual({
      "dua-calamity": { current: 0, longest: 0 },
    });
  });
});

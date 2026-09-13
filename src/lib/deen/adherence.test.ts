import { describe, expect, it } from "vitest";
import {
  calculateAdherence,
  dayCompletion,
  daysInWindow,
  hasQada,
  overallAdherence,
  windowStrip,
} from "./adherence";
import { windowDates } from "./dates";
import { emptyDay } from "./schemas";
import { fajrOnTimeStreak } from "./streaks";
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
  it("a missed day lowers adherence", () => {
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

describe("daysInWindow", () => {
  const logged = ["2026-07-01", "2026-07-31", "2026-08-27", "2026-09-08"].map(
    (date) => makeDay(date, { fajr: "qada" }),
  );

  it("keeps only the last forty days, today last", () => {
    // The window opens on 2026-07-31, so the July 1st record falls out of it.
    const windowed = daysInWindow(logged, "2026-09-08");
    expect(windowed.map((d) => d.date)).toEqual([
      "2026-07-31",
      "2026-08-27",
      "2026-09-08",
    ]);
  });

  it("measures adherence over the days present when there are fewer than 40", () => {
    const days = [
      makeDay("2026-09-07", { fajr: "ontime" }),
      makeDay("2026-09-08", { fajr: "missed" }),
    ];
    const windowed = daysInWindow(days, "2026-09-08");
    expect(windowed).toHaveLength(2);
    expect(calculateAdherence(windowed, windowed.length, 100).fajr!.percentage).toBe(
      50,
    );
  });

  it("is empty, and scores zero, with nothing logged", () => {
    expect(daysInWindow([], "2026-09-08")).toEqual([]);
    expect(overallAdherence([], 0, 100).percentage).toBe(0);
  });

  it("drops a day logged in the future", () => {
    const days = [makeDay("2026-09-09", { fajr: "ontime" })];
    expect(daysInWindow(days, "2026-09-08")).toEqual([]);
  });
});

describe("streaks against the adherence window", () => {
  // A streak has no denominator, so it never had the mismatch the window
  // exists to fix, and it runs over the whole history rather than the window.
  // The run here starts before the window opens (2026-07-31), so a streak
  // measured over the windowed days alone would be capped at 40.
  const today = "2026-09-08";
  const days = windowDates(today, 46).map((date) =>
    makeDay(date, { fajr: "ontime" }),
  );

  it("runs over the whole history, not the window", () => {
    expect(days[0]!.date).toBe("2026-07-25");
    expect(fajrOnTimeStreak(days, today)).toEqual({ current: 46, longest: 46 });
    expect(fajrOnTimeStreak(daysInWindow(days, today), today)).toEqual({
      current: 40,
      longest: 40,
    });
  });
});

describe("windowStrip", () => {
  const days = [
    makeDay("2026-09-01", {
      fajr: "ontime",
      dhuhr: "ontime",
      asr: "qada",
      maghrib: "ontime",
      isha: "ontime",
      morning_adhkar: true,
      istighfar_count: 100,
    }),
    makeDay("2026-09-02", { fajr: "ontime" }),
    makeDay("2026-09-03", { fajr: "missed" }),
  ];

  it("runs the last forty days to today, and marks today", () => {
    const marks = windowStrip(days, "2026-09-04", 100);
    expect(marks).toHaveLength(40);
    expect(marks.at(0)?.date).toBe("2026-07-27");
    expect(marks.at(-1)?.date).toBe("2026-09-04");
    expect(marks.filter((mark) => mark.today).map((mark) => mark.date)).toEqual([
      "2026-09-04",
    ]);
  });

  it("empties a day with nothing kept, logged or not", () => {
    const marks = windowStrip(days, "2026-09-04", 100);
    // 09-01 kept most of the day but prayed Asr late, so it reads amber, not
    // green: lateness outranks a high count.
    expect(marks.slice(-4).map((mark) => mark.state)).toEqual([
      "late",
      "partial",
      "empty",
      "empty",
    ]);
    expect(windowStrip([], "2026-09-04", 100).every((m) => m.state === "empty")).toBe(
      true,
    );
  });
});

describe("a late day in the strip", () => {
  it("reads late whatever else the day holds", () => {
    const whole = makeDay("2026-09-01", {
      fajr: "ontime",
      dhuhr: "ontime",
      asr: "ontime",
      maghrib: "ontime",
      isha: "qada",
      morning_adhkar: true,
      evening_adhkar: true,
      night_ayat_kursi: true,
      night_baqarah: true,
      night_three_suras: true,
      ruqyah: true,
      istighfar_count: 100,
    });
    expect(hasQada(whole)).toBe(true);
    expect(windowStrip([whole], "2026-09-01", 100).at(-1)?.state).toBe("late");
  });
  it("reads hit when nothing was late", () => {
    const day = makeDay("2026-09-01", {
      fajr: "ontime",
      dhuhr: "ontime",
      asr: "ontime",
      maghrib: "ontime",
      isha: "ontime",
      morning_adhkar: true,
      evening_adhkar: true,
    });
    expect(hasQada(day)).toBe(false);
    expect(windowStrip([day], "2026-09-01", 100).at(-1)?.state).toBe("hit");
  });
});

describe("dayCompletion", () => {
  it("counts the same twelve things adherence divides by", () => {
    expect(dayCompletion(makeDay("2026-09-01"), 100)).toBe(0);
    const whole = makeDay("2026-09-01", {
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
    });
    expect(dayCompletion(whole, 100)).toBe(1);
    expect(dayCompletion(makeDay("2026-09-01", { fajr: "missed" }), 100)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  calculateAdherence,
  cycleStrip,
  dayCompletion,
  daysInCycleWindow,
  hasQada,
  overallAdherence,
} from "./adherence";
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

describe("streaks against the adherence window", () => {
  // A streak has no denominator, so it never had the mismatch the window
  // exists to fix, and it must run to today. Past cycle day 40 the window
  // ends before today, which would report every live streak as zero.
  const days = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"].map(
    (date) => makeDay(date, { fajr: "ontime" }),
  );

  it("reports a live streak past day 40 of a cycle", () => {
    const today = "2026-09-08";
    const cycleStart = "2026-07-28"; // day 43 on today; window ends 2026-09-05
    const windowed = daysInCycleWindow(days, cycleStart, today);
    expect(windowed.at(-1)!.date).toBe("2026-09-05");
    expect(fajrOnTimeStreak(windowed, today).current).toBe(0);
    expect(fajrOnTimeStreak(days, today).current).toBe(4);
  });
});

describe("cycleStrip", () => {
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

  it("marks a cycle day by day, and today with itself", () => {
    const marks = cycleStrip(days, "2026-09-01", "2026-09-04", 100);
    expect(marks).toHaveLength(40);
    // 09-01 kept most of the day but prayed Asr late, so it reads amber, not
    // green: lateness outranks a high count.
    expect(marks.slice(0, 5).map((mark) => mark.state)).toEqual([
      "late",
      "partial",
      "empty",
      "empty",
      "future",
    ]);
    expect(marks.filter((mark) => mark.today).map((mark) => mark.date)).toEqual([
      "2026-09-04",
    ]);
  });

  it("falls back to the trailing forty days when no cycle is set", () => {
    const marks = cycleStrip(days, null, "2026-09-04", 100);
    expect(marks).toHaveLength(40);
    expect(marks.at(-1)?.date).toBe("2026-09-04");
    expect(marks.at(0)?.date).toBe("2026-07-27");
    expect(marks.every((mark) => mark.state !== "future")).toBe(true);
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
    expect(cycleStrip([whole], null, "2026-09-01", 100).at(-1)?.state).toBe(
      "late",
    );
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
    expect(cycleStrip([day], null, "2026-09-01", 100).at(-1)?.state).toBe("hit");
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

import { describe, expect, it } from "vitest";
import {
  PRACTICE_KEYS,
  SALAH_KEYS,
  calculateAdherence,
  dayCompletion,
  daysInWindow,
  emptyDaysNote,
  groupAdherence,
  markLabel,
  nasrStatus,
  overallAdherence,
  practiceProgress,
  unloggedDays,
  windowStrip,
  windowSummary,
  withDay,
} from "./adherence";
import { NASR_CONTENT, adhkarItemIds } from "./content";
import { windowDates } from "./dates";
import { emptyDay } from "./schemas";
import { fajrOnTimeStreak } from "./streaks";
import type { NasrDay } from "./schemas";

function makeDay(date: string, overrides: Partial<NasrDay> = {}): NasrDay {
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

describe("windowSummary with a newly logged day", () => {
  // The homepage's optimistic log: today had no row, then Fajr is logged.
  const today = "2026-09-08";
  const before = [makeDay("2026-09-07", { fajr: "ontime" })];
  const day = makeDay(today, { fajr: "ontime" });

  it("adds today to the window, the strip, and the figures", () => {
    const days = withDay(before, day);
    const summary = windowSummary(days, today, 100);
    expect(windowSummary(before, today, 100).windowDays).toBe(1);
    expect(summary.windowDays).toBe(2);
    expect(summary.adherence).toEqual(
      calculateAdherence(daysInWindow(days, today), 2, 100),
    );
    expect(summary.fajrStreak).toEqual({ current: 2, longest: 2 });
    expect(windowStrip(days, today).at(-1)).toMatchObject({ ontime: 1 });
  });

  it("replaces today's row rather than adding a second one", () => {
    const logged = withDay(before, day);
    const days = withDay(logged, { ...day, dhuhr: "qada" });
    expect(days.map((d) => d.date)).toEqual(["2026-09-07", today]);
    expect(days.at(-1)).toMatchObject({ fajr: "ontime", dhuhr: "qada" });
    expect(windowSummary(days, today, 100).windowDays).toBe(2);
  });

  it("keeps the list in date order", () => {
    const later = [makeDay("2026-09-09"), makeDay("2026-09-10")];
    expect(withDay(later, day).map((d) => d.date)).toEqual([
      today,
      "2026-09-09",
      "2026-09-10",
    ]);
  });
});

describe("windowStrip", () => {
  const days = [
    makeDay("2026-09-01", {
      fajr: "ontime",
      dhuhr: "ontime",
      asr: "qada",
      maghrib: "ontime",
      isha: "missed",
      morning_adhkar: true,
      istighfar_count: 100,
    }),
    makeDay("2026-09-02", { fajr: "ontime" }),
    makeDay("2026-09-03", {}),
  ];

  it("runs the last forty days to today, and marks today", () => {
    const marks = windowStrip(days, "2026-09-04");
    expect(marks).toHaveLength(40);
    expect(marks.at(0)?.date).toBe("2026-07-27");
    expect(marks.at(-1)?.date).toBe("2026-09-04");
    expect(marks.filter((mark) => mark.today).map((mark) => mark.date)).toEqual([
      "2026-09-04",
    ]);
  });

  it("counts the five prayers of a day by status", () => {
    const marks = windowStrip(days, "2026-09-04");
    expect(marks.at(-4)).toEqual({
      date: "2026-09-01",
      ontime: 3,
      qada: 1,
      missed: 1,
      today: false,
    });
  });

  it("leaves the unlogged prayers of a part-logged day out of the counts", () => {
    const mark = windowStrip(days, "2026-09-02").at(-1);
    expect(mark).toMatchObject({ ontime: 1, qada: 0, missed: 0 });
  });

  it("zeroes a day with no prayer logged, whether or not the day exists", () => {
    const marks = windowStrip(days, "2026-09-04");
    // 09-03 was logged with nothing set; 09-04 was never logged at all.
    expect(marks.slice(-2).map((mark) => [mark.ontime, mark.qada, mark.missed]))
      .toEqual([
        [0, 0, 0],
        [0, 0, 0],
      ]);
    expect(
      windowStrip([], "2026-09-04").every(
        (mark) => mark.ontime + mark.qada + mark.missed === 0,
      ),
    ).toBe(true);
  });
});

describe("markLabel", () => {
  it("names each status it holds, in a fixed status order", () => {
    const mark = windowStrip(
      [
        makeDay("2026-09-01", {
          fajr: "ontime",
          dhuhr: "qada",
          asr: "qada",
          maghrib: "qada",
          isha: "missed",
        }),
      ],
      "2026-09-01",
    ).at(-1)!;
    expect(markLabel(mark)).toBe("2026-09-01 — 1 on time, 3 qada, 1 missed");
  });

  it("drops a status the day does not hold", () => {
    const mark = windowStrip(
      [makeDay("2026-09-01", { fajr: "ontime", dhuhr: "missed" })],
      "2026-09-01",
    ).at(-1)!;
    expect(markLabel(mark)).toBe("2026-09-01 — 1 on time, 1 missed");
  });

  it("reads as not logged when the day holds no prayer", () => {
    const mark = windowStrip([], "2026-09-01").at(-1)!;
    expect(markLabel(mark)).toBe("2026-09-01 — not logged");
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

describe("groupAdherence", () => {
  const days = [
    makeDay("2026-09-01", {
      fajr: "ontime",
      dhuhr: "qada",
      asr: "missed",
      morning_adhkar: true,
      istighfar_count: 100,
    }),
    makeDay("2026-09-02", {
      fajr: "qada",
      dhuhr: "ontime",
      asr: "ontime",
      maghrib: "ontime",
      isha: "ontime",
    }),
  ];
  const adherence = calculateAdherence(days, 2, 100);

  it("counts a prayer prayed on time or as qada, over every prayer of the logged days", () => {
    // Two of five on the first day, five of five on the second.
    expect(groupAdherence(adherence, SALAH_KEYS)).toEqual({
      percentage: 70,
      completed: 7,
      total: 10,
    });
  });

  it("sums the seven practices the same way", () => {
    // Morning adhkar and the istighfar target, both on the first day.
    expect(groupAdherence(adherence, PRACTICE_KEYS)).toEqual({
      percentage: 14,
      completed: 2,
      total: 14,
    });
  });

  it("is zero over an empty window, or with no keys", () => {
    expect(groupAdherence(calculateAdherence([], 0, 100), SALAH_KEYS)).toEqual({
      percentage: 0,
      completed: 0,
      total: 0,
    });
    expect(groupAdherence(adherence, [])).toEqual({
      percentage: 0,
      completed: 0,
      total: 0,
    });
  });
});

describe("unloggedDays", () => {
  const today = "2026-10-21";

  it("lists the earlier days with no row, oldest first, and leaves today out", () => {
    const days = ["2026-10-15", "2026-10-17", "2026-10-18"].map((date) =>
      makeDay(date),
    );
    expect(unloggedDays(days, today)).toEqual([
      "2026-10-16",
      "2026-10-19",
      "2026-10-20",
    ]);
  });

  it("starts counting at the first day logged in the window", () => {
    // Someone who began on the 19th is not told about the weeks before.
    expect(unloggedDays([makeDay("2026-10-19")], today)).toEqual(["2026-10-20"]);
    expect(unloggedDays([makeDay(today)], today)).toEqual([]);
    expect(unloggedDays([], today)).toEqual([]);
  });

  it("takes a row with nothing set in it as logged", () => {
    expect(
      unloggedDays([makeDay("2026-10-19"), makeDay("2026-10-20")], today),
    ).toEqual([]);
  });

  it("does not start the count at a row from before the window", () => {
    // The window opens on 2026-09-12.
    expect(
      unloggedDays([makeDay("2026-09-01"), makeDay("2026-10-20")], today),
    ).toEqual([]);
  });
});

describe("emptyDaysNote", () => {
  it("names one day, two, or three", () => {
    expect(emptyDaysNote(["2026-10-20"])).toBe("20 October is empty.");
    expect(emptyDaysNote(["2026-10-19", "2026-10-20"])).toBe(
      "19 and 20 October are empty.",
    );
    expect(emptyDaysNote(["2026-10-18", "2026-10-19", "2026-10-20"])).toBe(
      "18, 19 and 20 October are empty.",
    );
  });

  it("names each month once, after the last of its days", () => {
    expect(emptyDaysNote(["2026-09-30", "2026-10-01"])).toBe(
      "30 September and 1 October are empty.",
    );
    expect(emptyDaysNote(["2026-09-30", "2026-10-01", "2026-10-02"])).toBe(
      "30 September, 1 and 2 October are empty.",
    );
  });

  it("names only the three most recent", () => {
    expect(
      emptyDaysNote([
        "2026-10-02",
        "2026-10-09",
        "2026-10-18",
        "2026-10-19",
        "2026-10-20",
      ]),
    ).toBe("18, 19 and 20 October are empty.");
  });

  it("says nothing when no day is empty", () => {
    expect(emptyDaysNote([])).toBeNull();
  });
});

describe("practiceProgress", () => {
  it("counts the items ticked on Today against each practice's guide", () => {
    const morning = adhkarItemIds("morning_adhkar");
    const ruqyah = adhkarItemIds("ruqyah");
    const day = makeDay("2026-10-21", {
      adhkar_ticks: [...morning.slice(0, 3), ...ruqyah],
      ruqyah: true,
      night_baqarah: true,
    });
    expect(practiceProgress(day, NASR_CONTENT)).toEqual([
      {
        key: "morning_adhkar",
        label: "Morning adhkar",
        complete: false,
        done: 3,
        total: 11,
      },
      {
        key: "evening_adhkar",
        label: "Evening adhkar",
        complete: false,
        done: 0,
        total: 12,
      },
      {
        key: "night",
        label: "Night recitation",
        complete: false,
        done: 1,
        total: 3,
      },
      { key: "ruqyah", label: "Self-ruqyah", complete: true, done: 8, total: 8 },
    ]);
  });

  it("calls the night done only when all three recitations are", () => {
    const day = makeDay("2026-10-21", {
      night_ayat_kursi: true,
      night_baqarah: true,
      night_three_suras: true,
    });
    expect(practiceProgress(day, NASR_CONTENT)[2]).toMatchObject({
      complete: true,
      done: 3,
      total: 3,
    });
  });
});

describe("nasrStatus", () => {
  const today = "2026-10-21";

  it("counts today's prayers that have a status, missed included", () => {
    const day = makeDay(today, { fajr: "ontime", dhuhr: "missed" });
    expect(nasrStatus(day, [day], today)).toEqual([
      { id: "prayers", card: "nasr", lead: "2", text: "of 5 prayers logged" },
    ]);
  });

  it("always says how many prayers are logged, zero included", () => {
    expect(nasrStatus(makeDay(today), [], today)).toEqual([
      { id: "prayers", card: "nasr", lead: "0", text: "of 5 prayers logged" },
    ]);
  });

  it("adds the earlier unlogged days, singular for one", () => {
    const day = makeDay(today);
    expect(
      nasrStatus(day, [makeDay("2026-10-18"), makeDay("2026-10-20")], today)[1],
    ).toEqual({
      id: "unlogged",
      card: "nasr",
      lead: "1",
      text: "earlier day unlogged",
    });
    expect(nasrStatus(day, [makeDay("2026-10-17")], today)[1]).toEqual({
      id: "unlogged",
      card: "nasr",
      lead: "3",
      text: "earlier days unlogged",
    });
  });
});

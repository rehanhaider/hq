import type { DeenDay } from "./schemas";
import { cycleDatesForDay, datesInRange, shiftDate } from "./cycle";

export interface AdherenceResult {
  percentage: number;
  completed: number;
  total: number;
}

/**
 * Restricts days to the span the adherence denominator measures.
 *
 * Every percentage divides a count of days by `cycleDays`, so the two have to
 * describe the same span. Counting all history against a denominator of
 * `min(cycleDay, 40)` reads over 100% — a cycle started today scores its first
 * day against every day ever logged.
 *
 * With a cycle set the span is that cycle, ending no later than today; without
 * one it is the trailing 40 days, which is the longest span a cycle can cover.
 */
export function daysInCycleWindow(
  days: DeenDay[],
  cycleStartDate: string | null,
  today: string,
): DeenDay[] {
  if (cycleStartDate) {
    const dates = cycleDatesForDay(cycleStartDate);
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    const end = last > today ? today : last;
    return days.filter((d) => d.date >= first && d.date <= end);
  }
  const first = shiftDate(today, -39);
  return days.filter((d) => d.date >= first && d.date <= today);
}

export function calculateAdherence(
  days: DeenDay[],
  cycleDays: number,
  istighfarTarget: number,
): Record<string, AdherenceResult> {
  const prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
  const booleans = [
    "morning_adhkar",
    "evening_adhkar",
    "night_ayat_kursi",
    "night_baqarah",
    "night_three_suras",
    "ruqyah",
  ] as const;

  const result: Record<string, AdherenceResult> = {};

  for (const prayer of prayers) {
    const completed = days.filter(
      (d) => d[prayer] === "ontime" || d[prayer] === "qada",
    ).length;
    result[prayer] = {
      percentage: cycleDays > 0 ? Math.round((completed / cycleDays) * 100) : 0,
      completed,
      total: cycleDays,
    };
  }

  const fajrOntime = days.filter((d) => d.fajr === "ontime").length;
  result.fajr_ontime = {
    percentage: cycleDays > 0 ? Math.round((fajrOntime / cycleDays) * 100) : 0,
    completed: fajrOntime,
    total: cycleDays,
  };

  for (const item of booleans) {
    const completed = days.filter((d) => d[item]).length;
    result[item] = {
      percentage: cycleDays > 0 ? Math.round((completed / cycleDays) * 100) : 0,
      completed,
      total: cycleDays,
    };
  }

  const istighfarCompleted = days.filter(
    (d) => d.istighfar_count >= istighfarTarget,
  ).length;
  result.istighfar = {
    percentage:
      cycleDays > 0 ? Math.round((istighfarCompleted / cycleDays) * 100) : 0,
    completed: istighfarCompleted,
    total: cycleDays,
  };

  return result;
}

export function overallAdherence(
  days: DeenDay[],
  cycleDays: number,
  istighfarTarget: number,
): AdherenceResult {
  const items = calculateAdherence(days, cycleDays, istighfarTarget);
  const keys = Object.keys(items).filter((k) => k !== "fajr_ontime");
  if (keys.length === 0) return { percentage: 0, completed: 0, total: 0 };

  const totalCompleted = keys.reduce(
    (sum, k) => sum + (items[k]?.completed ?? 0),
    0,
  );
  const totalPossible = keys.reduce((sum, k) => sum + (items[k]?.total ?? 0), 0);

  return {
    percentage:
      totalPossible > 0 ? Math.round((totalCompleted / totalPossible) * 100) : 0,
    completed: totalCompleted,
    total: totalPossible,
  };
}

/**
 * How much of one day was kept, as a fraction of the twelve things it holds:
 * the five prayers, the six adhkar and practices, and the istighfar target.
 * The same twelve `calculateAdherence` divides by, so a strip of days and the
 * percentage above it are measuring the same thing.
 */
export function dayCompletion(day: DeenDay, istighfarTarget: number): number {
  const prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
  const booleans = [
    "morning_adhkar",
    "evening_adhkar",
    "night_ayat_kursi",
    "night_baqarah",
    "night_three_suras",
    "ruqyah",
  ] as const;
  let kept = 0;
  for (const prayer of prayers)
    if (day[prayer] === "ontime" || day[prayer] === "qada") kept++;
  for (const item of booleans) if (day[item]) kept++;
  if (istighfarTarget > 0 && day.istighfar_count >= istighfarTarget) kept++;
  return kept / (prayers.length + booleans.length + 1);
}

export type DayMark = {
  date: string;
  /**
   * `late` is a day holding a prayer prayed outside its window; it outranks
   * `hit` because lateness is the thing worth seeing. `empty` is a day with
   * no record; `future` has not happened yet.
   */
  state: "hit" | "late" | "partial" | "empty" | "future";
  today: boolean;
};

/** A day is late if any of its five prayers was prayed as qada. */
export function hasQada(day: DeenDay): boolean {
  return (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).some(
    (prayer) => day[prayer] === "qada",
  );
}

/**
 * One mark per day of the cycle. Without a cycle start date it is the
 * trailing forty days ending today, which is the same window adherence uses,
 * so the strip and the ring never disagree.
 */
export function cycleStrip(
  days: DeenDay[],
  cycleStartDate: string | null,
  today: string,
  istighfarTarget: number,
  length = 40,
): DayMark[] {
  const dates = cycleStartDate
    ? cycleDatesForDay(cycleStartDate, length)
    : datesInRange(shiftDate(today, -(length - 1)), today);
  const byDate = new Map(days.map((day) => [day.date, day]));
  return dates.map((date) => {
    const day = byDate.get(date);
    const completion = day ? dayCompletion(day, istighfarTarget) : 0;
    const state =
      date > today
        ? ("future" as const)
        : day && hasQada(day)
          ? ("late" as const)
          : completion >= 0.5
            ? ("hit" as const)
            : completion > 0
              ? ("partial" as const)
              : ("empty" as const);
    return { date, state, today: date === today };
  });
}

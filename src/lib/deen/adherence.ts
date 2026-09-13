import type { DeenDay } from "./schemas";
import { windowDates } from "./dates";

export interface AdherenceResult {
  percentage: number;
  completed: number;
  total: number;
}

/**
 * The logged days inside the rolling window adherence is measured over: the
 * last forty calendar days, today last.
 *
 * Every percentage divides a count of days by the same denominator, so the two
 * have to describe the same span. Counting all history against forty days
 * reads over 100%.
 */
export function daysInWindow(
  days: DeenDay[],
  today: string,
  length = 40,
): DeenDay[] {
  const first = windowDates(today, length)[0]!;
  return days.filter((d) => d.date >= first && d.date <= today);
}

export function calculateAdherence(
  days: DeenDay[],
  windowDays: number,
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
      percentage: windowDays > 0 ? Math.round((completed / windowDays) * 100) : 0,
      completed,
      total: windowDays,
    };
  }

  const fajrOntime = days.filter((d) => d.fajr === "ontime").length;
  result.fajr_ontime = {
    percentage: windowDays > 0 ? Math.round((fajrOntime / windowDays) * 100) : 0,
    completed: fajrOntime,
    total: windowDays,
  };

  for (const item of booleans) {
    const completed = days.filter((d) => d[item]).length;
    result[item] = {
      percentage: windowDays > 0 ? Math.round((completed / windowDays) * 100) : 0,
      completed,
      total: windowDays,
    };
  }

  const istighfarCompleted = days.filter(
    (d) => d.istighfar_count >= istighfarTarget,
  ).length;
  result.istighfar = {
    percentage:
      windowDays > 0 ? Math.round((istighfarCompleted / windowDays) * 100) : 0,
    completed: istighfarCompleted,
    total: windowDays,
  };

  return result;
}

export function overallAdherence(
  days: DeenDay[],
  windowDays: number,
  istighfarTarget: number,
): AdherenceResult {
  const items = calculateAdherence(days, windowDays, istighfarTarget);
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
   * nothing kept, whether it was logged that way or never logged.
   */
  state: "hit" | "late" | "partial" | "empty";
  today: boolean;
};

/** A day is late if any of its five prayers was prayed as qada. */
export function hasQada(day: DeenDay): boolean {
  return (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).some(
    (prayer) => day[prayer] === "qada",
  );
}

/**
 * One mark per day of the rolling window, today last. It is the window
 * adherence draws from, though adherence scores only the logged days, and it
 * holds no future day: the window ends today.
 */
export function windowStrip(
  days: DeenDay[],
  today: string,
  istighfarTarget: number,
  length = 40,
): DayMark[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return windowDates(today, length).map((date) => {
    const day = byDate.get(date);
    const completion = day ? dayCompletion(day, istighfarTarget) : 0;
    const state =
      day && hasQada(day)
        ? ("late" as const)
        : completion >= 0.5
          ? ("hit" as const)
          : completion > 0
            ? ("partial" as const)
            : ("empty" as const);
    return { date, state, today: date === today };
  });
}

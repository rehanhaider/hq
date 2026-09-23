import type { NasrDay } from "./schemas";
import { windowDates } from "./dates";
import { fajrOnTimeStreak } from "./streaks";

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
  days: NasrDay[],
  today: string,
  length = 40,
): NasrDay[] {
  const first = windowDates(today, length)[0]!;
  return days.filter((d) => d.date >= first && d.date <= today);
}

export function calculateAdherence(
  days: NasrDay[],
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
  days: NasrDay[],
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
 * Everything the pages derive from the day list: the window count, the Fajr
 * streak, and adherence over the window. The server builds its summary with
 * this, and the homepage reruns it when it logs a prayer optimistically, so
 * the ring and strip move with the prayer rather than a round trip later.
 */
export function windowSummary(
  days: NasrDay[],
  today: string,
  istighfarTarget: number,
) {
  const windowed = daysInWindow(days, today);
  // Fewer than 40 days logged scores against the days that exist, so a week
  // of records is not read as a week out of forty.
  const windowDays = windowed.length;
  return {
    // How much of the window is actually logged, so the pages can tell an
    // empty window apart from an empty history rather than inferring it from
    // zeroes.
    windowDays,
    // Deliberately not windowed. A streak has no denominator, so it never had
    // the mismatch the window exists to fix, and it runs to today.
    fajrStreak: fajrOnTimeStreak(days, today),
    adherence: calculateAdherence(windowed, windowDays, istighfarTarget),
    overall: overallAdherence(windowed, windowDays, istighfarTarget),
  };
}

/** The day list with `day` in place of its date's row, still in date order. */
export function withDay(days: NasrDay[], day: NasrDay): NasrDay[] {
  return [...days.filter((d) => d.date !== day.date), day].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/**
 * How much of one day was kept, as a fraction of the twelve things it holds:
 * the five prayers, the six adhkar and practices, and the istighfar target.
 * The same twelve `calculateAdherence` divides by, so a strip of days and the
 * percentage above it are measuring the same thing.
 */
export function dayCompletion(day: NasrDay, istighfarTarget: number): number {
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
  /** Counts of the five prayers by status; unlogged prayers make up the remainder of 5. */
  ontime: number;
  qada: number;
  missed: number;
  today: boolean;
};

/**
 * One mark per day of the rolling window, today last. It is the window
 * adherence draws from, though adherence scores only the logged days, and it
 * holds no future day: the window ends today.
 *
 * A mark carries the day's five prayers counted by status rather than one
 * verdict for the day, so a day of three on time and two qada can be drawn as
 * the mix it was instead of collapsing to a single colour.
 */
export function windowStrip(
  days: NasrDay[],
  today: string,
  length = 40,
): DayMark[] {
  const prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
  const byDate = new Map(days.map((day) => [day.date, day]));
  return windowDates(today, length).map((date) => {
    const day = byDate.get(date);
    const statuses = day ? prayers.map((prayer) => day[prayer]) : [];
    return {
      date,
      ontime: statuses.filter((status) => status === "ontime").length,
      qada: statuses.filter((status) => status === "qada").length,
      missed: statuses.filter((status) => status === "missed").length,
      today: date === today,
    };
  });
}

/** What a mark says when read aloud, or hovered: the counts behind its mix. */
export function markLabel(mark: DayMark): string {
  const parts: string[] = [];
  if (mark.ontime > 0) parts.push(`${mark.ontime} on time`);
  if (mark.qada > 0) parts.push(`${mark.qada} qada`);
  if (mark.missed > 0) parts.push(`${mark.missed} missed`);
  return `${mark.date} — ${parts.length > 0 ? parts.join(", ") : "not logged"}`;
}

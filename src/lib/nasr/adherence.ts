import type { NasrContent, NasrDay, NasrGuideKey } from "./schemas";
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

/** The five prayers. Home's Salah figure sums these, as Progress lists them. */
export const SALAH_KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
/** The rest of a day. Home's Practices figure sums these. */
export const PRACTICE_KEYS = [
  "morning_adhkar",
  "evening_adhkar",
  "night_ayat_kursi",
  "night_baqarah",
  "night_three_suras",
  "ruqyah",
  "istighfar",
] as const;

/**
 * Several adherence figures read as one: what was kept over what could have
 * been, summed across `keys`. A prayer counts as kept on time or as qada, the
 * same as in its own figure.
 */
export function groupAdherence(
  adherence: Record<string, AdherenceResult>,
  keys: readonly string[],
): AdherenceResult {
  let completed = 0;
  let total = 0;
  for (const key of keys) {
    completed += adherence[key]?.completed ?? 0;
    total += adherence[key]?.total ?? 0;
  }
  return {
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    completed,
    total,
  };
}

/**
 * Everything the pages derive from the day list: the window count, the Fajr
 * streak, and adherence over the window. The server builds its summary with
 * this, and the homepage reruns it when it logs a prayer optimistically, so
 * the strip and its figures move with the prayer rather than a round trip
 * later.
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

/**
 * The days before today in the window that have no row, oldest first. The
 * count starts at the first day logged in the window, so someone who began
 * last week is not told the weeks before it went unlogged. Today is left out
 * because it is still being logged.
 */
export function unloggedDays(
  days: NasrDay[],
  today: string,
  length = 40,
): string[] {
  const logged = new Set(days.map((day) => day.date));
  const earlier = windowDates(today, length).slice(0, -1);
  const first = earlier.findIndex((date) => logged.has(date));
  if (first < 0) return [];
  return earlier.slice(first).filter((date) => !logged.has(date));
}

/**
 * The most recent of those days, named for the line under the strip: "19 and
 * 20 October are empty." A month is named once, after the last of its days.
 */
export function emptyDaysNote(unlogged: string[], limit = 3): string | null {
  const shown = unlogged.slice(Math.max(0, unlogged.length - limit));
  if (shown.length === 0) return null;
  const names = shown.map((date, index) => {
    const day = String(Number(date.slice(8, 10)));
    const next = shown[index + 1];
    return next?.slice(0, 7) === date.slice(0, 7)
      ? day
      : `${day} ${monthName(date)}`;
  });
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0];
  return `${list} ${shown.length === 1 ? "is" : "are"} empty.`;
}

function monthName(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
}

export type PracticeProgress = {
  /** The guide this row opens on Today. */
  key: NasrGuideKey;
  label: string;
  /** Logged as done for the day. */
  complete: boolean;
  done: number;
  total: number;
};

/**
 * Home's four practice rows, read out of one day. Morning, evening and
 * self-ruqyah count the guide items ticked on Today; the night counts its
 * three recitations.
 */
export function practiceProgress(
  day: NasrDay,
  content: readonly NasrContent[],
): PracticeProgress[] {
  const ticked = (itemKey: "morning_adhkar" | "evening_adhkar" | "ruqyah") => {
    const ids = content
      .filter((item) => item.item_key === itemKey)
      .map((item) => item.id);
    return {
      done: ids.filter((id) => day.adhkar_ticks.includes(id)).length,
      total: ids.length,
    };
  };
  const night = [day.night_ayat_kursi, day.night_baqarah, day.night_three_suras];
  return [
    {
      key: "morning_adhkar",
      label: "Morning adhkar",
      complete: day.morning_adhkar,
      ...ticked("morning_adhkar"),
    },
    {
      key: "evening_adhkar",
      label: "Evening adhkar",
      complete: day.evening_adhkar,
      ...ticked("evening_adhkar"),
    },
    {
      key: "night",
      label: "Night recitation",
      complete: night.every(Boolean),
      done: night.filter(Boolean).length,
      total: night.length,
    },
    {
      key: "ruqyah",
      label: "Self-ruqyah",
      complete: day.ruqyah,
      ...ticked("ruqyah"),
    },
  ];
}

/**
 * One link of Home's status line. `lead` and `tail` are its figures and
 * `text` is the words between them. `card` is the id of the Home card the
 * link scrolls to. GitHub and Content build their links in this shape too.
 */
export type StatusSegment = {
  id: string;
  card: "nasr" | "waiting" | "flight";
  lead?: string;
  text: string;
  tail?: string;
};

/** The Nasr part of Home's status line: today's salah, then any gap before it. */
export function nasrStatus(
  day: NasrDay,
  days: NasrDay[],
  today: string,
): StatusSegment[] {
  const prayers = SALAH_KEYS.filter((key) => day[key] !== null).length;
  const unlogged = unloggedDays(days, today).length;
  const segments: StatusSegment[] = [
    {
      id: "prayers",
      card: "nasr",
      lead: String(prayers),
      text: "of 5 prayers logged",
    },
  ];
  if (unlogged > 0)
    segments.push({
      id: "unlogged",
      card: "nasr",
      lead: String(unlogged),
      text: unlogged === 1 ? "earlier day unlogged" : "earlier days unlogged",
    });
  return segments;
}

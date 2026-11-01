import type { NasrDay, PrayerStatus } from "./schemas";
import { adhkarItemIds } from "./content";

export interface StreakResult {
  current: number;
  longest: number;
}

type Prayer = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export function computeStreak<TDay extends Pick<NasrDay, "date">>(
  days: TDay[],
  predicate: (day: TDay) => boolean,
  today: string,
): StreakResult {
  if (days.length === 0) return { current: 0, longest: 0 };

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0;
  let running = 0;
  let lastMatchDate: string | null = null;

  for (const day of sorted) {
    if (predicate(day)) {
      if (lastMatchDate === null || dayDiff(lastMatchDate, day.date) === 1) {
        running++;
      } else {
        running = 1;
      }
      lastMatchDate = day.date;
      if (running > longest) longest = running;
    } else {
      running = 0;
      lastMatchDate = null;
    }
  }

  const current =
    lastMatchDate !== null &&
    (lastMatchDate === today || dayDiff(lastMatchDate, today) === 1)
      ? running
      : 0;

  return { current, longest };
}

function dayDiff(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function fajrOnTimeStreak(
  days: Pick<NasrDay, "date" | "fajr">[],
  today: string,
): StreakResult {
  return computeStreak(days, (d) => d.fajr === "ontime", today);
}

export function prayerStreak(
  days: Pick<NasrDay, "date" | Prayer>[],
  prayer: Prayer,
  statusFilter: PrayerStatus[],
  today: string,
): StreakResult {
  return computeStreak(
    days,
    (d) => {
      const val = d[prayer];
      return val !== null && statusFilter.includes(val);
    },
    today,
  );
}

export interface PracticeStreaks {
  morning_adhkar: StreakResult;
  evening_adhkar: StreakResult;
  /** One streak per daily dua, keyed by its guide item id. */
  duas: Record<string, StreakResult>;
}

type PracticeDay = Pick<
  NasrDay,
  "date" | "morning_adhkar" | "evening_adhkar" | "adhkar_ticks"
>;

/**
 * The adhkar and dua streaks Today shows. Morning and evening count a day once
 * every item in the set is ticked, which is when the set reads as complete. A
 * dua is one item, so its own tick is the whole day.
 *
 * Today is still open, so it counts once it is ticked and never breaks the
 * streak before then: ticking the morning set must not zero the evening one.
 */
export function practiceStreaks(
  days: PracticeDay[],
  today: string,
): PracticeStreaks {
  const streak = (done: (day: PracticeDay) => boolean) =>
    computeStreak(
      days.filter((day) => day.date !== today || done(day)),
      done,
      today,
    );
  return {
    morning_adhkar: streak((d) => d.morning_adhkar),
    evening_adhkar: streak((d) => d.evening_adhkar),
    duas: Object.fromEntries(
      adhkarItemIds("daily_duas").map((id) => [
        id,
        streak((d) => d.adhkar_ticks.includes(id)),
      ]),
    ),
  };
}

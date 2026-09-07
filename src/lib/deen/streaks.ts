import type { DeenDay, PrayerStatus } from "./schemas";

export interface StreakResult {
  current: number;
  longest: number;
}

type Prayer = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export function computeStreak<TDay extends Pick<DeenDay, "date">>(
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
  days: Pick<DeenDay, "date" | "fajr">[],
  today: string,
): StreakResult {
  return computeStreak(days, (d) => d.fajr === "ontime", today);
}

export function prayerStreak(
  days: Pick<DeenDay, "date" | Prayer>[],
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

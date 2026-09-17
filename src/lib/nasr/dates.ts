export function getToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
}

export function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Friday midday occupies the Dhuhr slot; only the displayed name changes.
 * Calendar dates are UTC days, matching the rest of Nasr's date helpers.
 */
export function middayPrayerLabel(date: string): "Jumuah" | "Dhuhr" {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 5 ? "Jumuah" : "Dhuhr";
}

/**
 * The rolling window every Nasr figure is measured over: the last `length`
 * calendar days, today last. There is no start date to set and no cycle to
 * finish — the window moves with the day, so it always exists.
 */
export function windowDates(today: string, length = 40): string[] {
  return datesInRange(shiftDate(today, -(length - 1)), today);
}

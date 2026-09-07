export function getToday(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

export function getCycleDay(
  cycleStartDate: string | null,
  today: string,
): number | null {
  if (!cycleStartDate) return null;
  const diff = daysBetween(cycleStartDate, today);
  if (diff < 0) return null;
  return diff + 1;
}

export function isCycleComplete(cycleDay: number | null): boolean {
  if (cycleDay === null) return false;
  return cycleDay > 40;
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

export function cycleDatesForDay(
  cycleStartDate: string,
  cycleLength = 40,
): string[] {
  const end = new Date(`${cycleStartDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + cycleLength - 1);
  return datesInRange(cycleStartDate, end.toISOString().slice(0, 10));
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

import type { summarize } from "./metrics";
import type { Filters } from "./model";
export const rangePresets = [1, 3, 6, 12, 24, 36, 48, 60, 72];
export const rangeLabel = (months: number) =>
  months < 12
    ? `${months} month${months === 1 ? "" : "s"}`
    : `${months / 12} year${months === 12 ? "" : "s"}`;
export function monthsBefore(to: string, months: number) {
  const end = new Date(`${to}T00:00:00Z`);
  const date = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1),
  );
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(last, end.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function utcDay(iso: string) {
  const value = iso.includes("T") ? iso : `${iso}T00:00:00.000Z`;
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function utcStamp(iso: string) {
  const value = iso.includes("T") ? iso : `${iso}T00:00:00.000Z`;
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export function dailyActivity(
  daily: ReturnType<typeof summarize>["daily"],
  from: string,
  to: string,
  coverage: { since: string; until: string }[],
) {
  const rows = [];
  const records = new Map(daily.map((d) => [d.day, d]));
  const cursor = new Date(`${from}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    const day = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const record = records.get(day);
    const overlap = coverage.some(
      (c) => c.since.slice(0, 10) <= day && c.until.slice(0, 10) >= day,
    );
    const complete =
      coverage.length > 0 &&
      coverage.every(
        (c) =>
          c.since <= `${day}T00:00:00.000Z` &&
          c.until >= `${day}T23:59:59.999Z`,
      );
    rows.push({
      from: day,
      to: day,
      day,
      coverage: complete ? "complete" : overlap ? "partial" : "none",
      commits: record?.commits ?? 0,
      prs: record?.prs ?? 0,
      lines: (record?.additions ?? 0) + (record?.deletions ?? 0),
    });
  }
  return rows;
}
export function activityValues(
  rows: ReturnType<typeof dailyActivity>,
  metric: Filters["metric"],
  mode: Filters["chart"],
) {
  let total = 0;
  return rows.map((row) => {
    total += row[metric];
    return row.coverage === "none"
      ? null
      : mode === "cumulative"
        ? total
        : row[metric];
  });
}

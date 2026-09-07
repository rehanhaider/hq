import type { DeenDay } from "./schemas";

export interface AdherenceResult {
  percentage: number;
  completed: number;
  total: number;
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

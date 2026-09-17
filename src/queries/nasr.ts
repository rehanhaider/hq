import { queryOptions } from "@tanstack/react-query";
import { getNasr, getNasrDay, getNasrSettings, getHome } from "@/server/fns";

export const nasrKeys = {
  all: ["nasr"] as const,
  home: ["home"] as const,
  summary: ["nasr", "summary"] as const,
  day: (date: string) => ["nasr", "day", date] as const,
  settings: ["nasr", "settings"] as const,
};

export const homeQuery = queryOptions({
  queryKey: nasrKeys.home,
  queryFn: () => getHome(),
  // Fresh enough that a render-preload makes the click instant, short enough
  // that the briefing never reads stale. Mutations invalidate explicitly.
  staleTime: 30000,
});

export const nasrQuery = queryOptions({
  queryKey: nasrKeys.summary,
  queryFn: () => getNasr(),
  staleTime: 30000,
});

export const nasrDayQuery = (date: string) =>
  queryOptions({
    queryKey: nasrKeys.day(date),
    queryFn: () => getNasrDay({ data: { date } }),
    enabled: Boolean(date),
    staleTime: 30000,
  });

export const nasrSettingsQuery = queryOptions({
  queryKey: nasrKeys.settings,
  queryFn: () => getNasrSettings(),
  staleTime: 30000,
});

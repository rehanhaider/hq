import { queryOptions } from "@tanstack/react-query";
import { getDeen, getDeenDay, getDeenSettings, getHome } from "@/server/fns";

export const deenKeys = {
  all: ["deen"] as const,
  home: ["home"] as const,
  summary: ["deen", "summary"] as const,
  day: (date: string) => ["deen", "day", date] as const,
  settings: ["deen", "settings"] as const,
};

export const homeQuery = queryOptions({
  queryKey: deenKeys.home,
  queryFn: () => getHome(),
  // Fresh enough that a render-preload makes the click instant, short enough
  // that the briefing never reads stale. Mutations invalidate explicitly.
  staleTime: 30000,
});

export const deenQuery = queryOptions({
  queryKey: deenKeys.summary,
  queryFn: () => getDeen(),
  staleTime: 30000,
});

export const deenDayQuery = (date: string) =>
  queryOptions({
    queryKey: deenKeys.day(date),
    queryFn: () => getDeenDay({ data: { date } }),
    enabled: Boolean(date),
    staleTime: 30000,
  });

export const deenSettingsQuery = queryOptions({
  queryKey: deenKeys.settings,
  queryFn: () => getDeenSettings(),
  staleTime: 30000,
});

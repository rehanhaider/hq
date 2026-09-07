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
});

export const deenQuery = queryOptions({
  queryKey: deenKeys.summary,
  queryFn: () => getDeen(),
});

export const deenDayQuery = (date: string) =>
  queryOptions({
    queryKey: deenKeys.day(date),
    queryFn: () => getDeenDay({ data: { date } }),
    enabled: Boolean(date),
  });

export const deenSettingsQuery = queryOptions({
  queryKey: deenKeys.settings,
  queryFn: () => getDeenSettings(),
});

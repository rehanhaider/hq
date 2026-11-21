import {
  mutationOptions,
  queryOptions,
  type Mutation,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getNasr,
  getNasrDay,
  getNasrSettings,
  getHome,
  updateNasrDay,
} from "@/server/fns";

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

export const istighfarMutationKey = ["nasr", "istighfar"] as const;

/** The Istighfar saves still on their way to the server, in tap order. */
export const pendingIstighfarFilters = {
  mutationKey: istighfarMutationKey,
  status: "pending",
} as const;

export interface IstighfarSave {
  date: string;
  istighfar_count: number;
}

/**
 * The count of the newest unsaved Istighfar tap on `date`, or undefined when
 * every tap there is saved. While a run of taps is saving, this is the count
 * to show and to build the next tap on: a day refetch that lands mid-run,
 * after a prayer is logged or a guide item ticked, carries only the saves
 * that reached the server, so the cached day can read lower.
 */
export function latestIstighfarCount(
  saves: ReadonlyArray<IstighfarSave | undefined>,
  date: string,
): number | undefined {
  for (let i = saves.length - 1; i >= 0; i--) {
    const save = saves[i];
    if (save?.date === date) return save.istighfar_count;
  }
  return undefined;
}

/** The day's Istighfar saves still on their way to the server, in tap order. */
export function pendingIstighfarSaves(
  client: QueryClient,
  date: string,
): IstighfarSave[] {
  return client
    .getMutationCache()
    .findAll(pendingIstighfarFilters)
    .map((mutation) => mutation.state.variables as IstighfarSave | undefined)
    .filter((save): save is IstighfarSave => save?.date === date);
}

export function pendingIstighfarCount(client: QueryClient, date: string) {
  return pendingIstighfarSaves(client, date).at(-1)?.istighfar_count;
}

/**
 * The save for one tap of `step` on `date`, built on the newest unsaved tap
 * there, else the cached day. Undefined until the day has loaded.
 */
export function nextIstighfarSave(
  client: QueryClient,
  date: string,
  step: number,
): IstighfarSave | undefined {
  const cached = client.getQueryData(nasrDayQuery(date).queryKey);
  if (!cached) return undefined;
  const current = pendingIstighfarCount(client, date) ?? cached.istighfar_count;
  return { date, istighfar_count: Math.max(0, current + step) };
}

export interface IstighfarOutcome {
  date: string;
  error: Error | null;
}

/** A finished Istighfar save's day and error, or undefined while pending. */
export function istighfarOutcome({
  state,
}: Mutation<unknown, Error, unknown>): IstighfarOutcome | undefined {
  const save = state.variables as IstighfarSave | undefined;
  if (!save || (state.status !== "success" && state.status !== "error"))
    return undefined;
  return { date: save.date, error: state.error };
}

/**
 * The error to show for Istighfar: a failure that is still the newest
 * finished save on its day, whichever day the page shows now. A later save
 * on that day stores the full count again, so its success clears it.
 */
export function istighfarSaveError(
  outcomes: ReadonlyArray<IstighfarOutcome | undefined>,
): Error | null {
  const newest = new Map<string, Error | null>();
  for (const outcome of outcomes)
    if (outcome) newest.set(outcome.date, outcome.error);
  for (const error of newest.values()) if (error) return error;
  return null;
}

/**
 * Istighfar is tapped in quick runs, so its saves never lock the page. They
 * share a scope, so they reach the server one at a time in tap order and the
 * last count sent is the one stored. Each save writes the day it returns to
 * that day's cache, so a day left mid-run comes back with its newest saved
 * count. Once a day has no saves left, the page refetches.
 */
export const istighfarMutationOptions = (client: QueryClient) =>
  mutationOptions({
    mutationKey: istighfarMutationKey,
    scope: { id: "nasr-istighfar" },
    mutationFn: (save: IstighfarSave) => updateNasrDay({ data: save }),
    onSuccess: (saved, { date }) => {
      client.setQueryData(nasrDayQuery(date).queryKey, saved);
    },
    onSettled: (_saved, _error, { date }) => {
      // This save still counts as pending here, so 1 means it was the last.
      if (pendingIstighfarSaves(client, date).length > 1) return;
      void client.invalidateQueries({ queryKey: nasrKeys.all });
      void client.invalidateQueries({ queryKey: nasrKeys.home });
    },
  });

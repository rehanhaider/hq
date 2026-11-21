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
  setNasrAdhkarItem,
  updateNasrDay,
} from "@/server/fns";
import {
  ADHKAR_KEYS,
  adhkarItemIds,
  optionalItemIds,
  type NasrAdhkarTick,
  type NasrDay,
  type NasrDayUpdate,
} from "@/lib/nasr";

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

/**
 * Every write to a Nasr day on Today, Istighfar included, shares one queue:
 * the writes reach the server one at a time in tap order, so each reply
 * holds every write before it, and the reply written to the cache last is
 * the newest.
 */
const dayWriteScope = { id: "nasr-day" };
const nasrWriteKey = ["nasr", "write"] as const;
export const istighfarMutationKey = [...nasrWriteKey, "istighfar"] as const;
export const dayWriteMutationKey = [...nasrWriteKey, "day"] as const;

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

/** A Salah, practice, guide tick or night recitation write on Today. */
export type DayWrite =
  | { kind: "update"; data: NasrDayUpdate }
  | { kind: "tick"; data: NasrAdhkarTick };

/** The day an Istighfar save or a day write is for. */
function writeDate(write: IstighfarSave | DayWrite): string {
  return "kind" in write ? write.data.date : write.date;
}

/**
 * `day` after `write`, by the rules the server applies: NasrStore.upsertDay
 * and NasrStore.setAdhkarItem. Marking a set done or not ticks or clears its
 * required items and leaves its optional ones; ticking an item marks the set
 * done once every required item is ticked.
 */
export function applyDayWrite(day: NasrDay, write: DayWrite): NasrDay {
  const ticks = new Set(day.adhkar_ticks);
  let next: NasrDay;
  if (write.kind === "tick") {
    const { item_id: id, done } = write.data;
    const key = ADHKAR_KEYS.find((key) =>
      [...adhkarItemIds(key), ...optionalItemIds(key)].includes(id),
    );
    if (!key) return day;
    if (done) ticks.add(id);
    else ticks.delete(id);
    next = { ...day, [key]: adhkarItemIds(key).every((id) => ticks.has(id)) };
  } else {
    const fields = Object.fromEntries(
      Object.entries(write.data).filter(([, value]) => value !== undefined),
    ) as Partial<NasrDay>;
    next = { ...day, ...fields };
    for (const key of ADHKAR_KEYS) {
      const value = write.data[key];
      if (value === undefined) continue;
      for (const id of adhkarItemIds(key)) {
        if (value) ticks.add(id);
        else ticks.delete(id);
      }
    }
  }
  next.adhkar_ticks = ADHKAR_KEYS.flatMap((key) =>
    [...adhkarItemIds(key), ...optionalItemIds(key)].filter((id) =>
      ticks.has(id),
    ),
  );
  return next;
}

/** The day writes still on their way to the server, in tap order. */
export const pendingDayWriteFilters = {
  mutationKey: dayWriteMutationKey,
  status: "pending",
} as const;

/**
 * `day` with the unsaved writes for it applied in tap order. A day refetch
 * that lands mid-run carries only the writes that reached the server, so the
 * page shows and builds on this instead of the cached day.
 */
export function withDayWrites(
  day: NasrDay,
  writes: ReadonlyArray<DayWrite | undefined>,
): NasrDay {
  return writes.reduce<NasrDay>(
    (current, write) =>
      write && write.data.date === day.date
        ? applyDayWrite(current, write)
        : current,
    day,
  );
}

/** The day as Today shows it now, or undefined until it has loaded. */
export function currentNasrDay(
  client: QueryClient,
  date: string,
): NasrDay | undefined {
  const cached = client.getQueryData(nasrDayQuery(date).queryKey);
  if (!cached) return undefined;
  const writes = client
    .getMutationCache()
    .findAll(pendingDayWriteFilters)
    .map((mutation) => mutation.state.variables as DayWrite | undefined);
  return withDayWrites(cached, writes);
}

/**
 * Write a returned day to the cache. The writes share one queue, so this is
 * the newest state. Once the day has no writes of either kind left, the page
 * refetches the day, the summary, and Home.
 */
function settleDayWrite(
  client: QueryClient,
  date: string,
  saved: NasrDay | undefined,
) {
  if (saved) client.setQueryData(nasrDayQuery(date).queryKey, saved);
  const queued = client
    .getMutationCache()
    .findAll({ mutationKey: nasrWriteKey, status: "pending" })
    .filter((mutation) => {
      const write = mutation.state.variables as
        | IstighfarSave
        | DayWrite
        | undefined;
      return write !== undefined && writeDate(write) === date;
    }).length;
  // This write still counts as pending here, so 1 means it was the day's last.
  if (queued > 1) return;
  void client.invalidateQueries({ queryKey: nasrKeys.all });
  void client.invalidateQueries({ queryKey: nasrKeys.home });
}

export interface SaveOutcome {
  date: string;
  error: Error | null;
}

/** A finished write's day and error, or undefined while pending. */
export function writeOutcome({
  state,
}: Mutation<unknown, Error, unknown>): SaveOutcome | undefined {
  const write = state.variables as IstighfarSave | DayWrite | undefined;
  if (!write || (state.status !== "success" && state.status !== "error"))
    return undefined;
  return { date: writeDate(write), error: state.error };
}

/**
 * The Istighfar error to show: a failure that is still the newest finished
 * save on its day, whichever day the page shows now. A later save on that
 * day stores the full count again, so its success clears it.
 */
export function saveFailure(
  outcomes: ReadonlyArray<SaveOutcome | undefined>,
): Error | null {
  const newest = new Map<string, Error | null>();
  for (const outcome of outcomes)
    if (outcome) newest.set(outcome.date, outcome.error);
  for (const error of newest.values()) if (error) return error;
  return null;
}

/**
 * Istighfar is tapped in quick runs, so its saves never lock the page. The
 * last count sent is the one stored, and a day left mid-run comes back with
 * its newest saved count.
 */
export const istighfarMutationOptions = (client: QueryClient) =>
  mutationOptions({
    mutationKey: istighfarMutationKey,
    scope: dayWriteScope,
    mutationFn: (save: IstighfarSave) => updateNasrDay({ data: save }),
    onSettled: (saved, _error, { date }) => settleDayWrite(client, date, saved),
  });

/**
 * The day-write error to show: the first failed write still in the cache,
 * whichever day the page shows now. A later write does not redo a failed
 * one, so a queued write's success leaves the alert up; the next tap on that
 * day clears it.
 */
export function dayWriteFailure(
  outcomes: ReadonlyArray<SaveOutcome | undefined>,
): Error | null {
  return outcomes.find((outcome) => outcome?.error)?.error ?? null;
}

/** Drop the failed day writes for `date`, as a new tap on it is made. */
function dismissFailedDayWrites(client: QueryClient, date: string) {
  const cache = client.getMutationCache();
  for (const mutation of cache.findAll({
    mutationKey: dayWriteMutationKey,
    status: "error",
  })) {
    const write = mutation.state.variables as DayWrite | undefined;
    if (write?.data.date === date) cache.remove(mutation);
  }
}

/**
 * Salah, practice, guide tick and night recitation writes. They never lock
 * the page: Today shows each one at once through withDayWrites.
 */
export const dayWriteMutationOptions = (client: QueryClient) =>
  mutationOptions({
    mutationKey: dayWriteMutationKey,
    scope: dayWriteScope,
    // Runs as the tap is made, even when the write queues behind others.
    onMutate: (write) => dismissFailedDayWrites(client, write.data.date),
    mutationFn: (write: DayWrite) =>
      write.kind === "tick"
        ? setNasrAdhkarItem({ data: write.data })
        : updateNasrDay({ data: write.data }),
    onSettled: (saved, _error, write) =>
      settleDayWrite(client, write.data.date, saved),
  });

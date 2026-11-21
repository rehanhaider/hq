import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  adhkarItemIds,
  emptyDay,
  optionalItemIds,
  type NasrDay,
} from "@/lib/nasr";
import { NasrStore } from "@/server/nasr";
import {
  applyDayWrite,
  currentNasrDay,
  dayWriteMutationKey,
  dayWriteMutationOptions,
  istighfarMutationKey,
  istighfarMutationOptions,
  latestIstighfarCount,
  nasrKeys,
  nextIstighfarSave,
  pendingIstighfarCount,
  saveFailure,
  writeOutcome,
  type DayWrite,
  type IstighfarSave,
} from "./nasr";

const date = "2026-11-21";
const dayBefore = "2026-11-20";

/**
 * The page's write options against a fake server that applies each write
 * with applyDayWrite and answers only when the test says so.
 */
function setup() {
  const client = new QueryClient();
  const server = new Map([date, dayBefore].map((day) => [day, emptyDay(day)]));
  const sent: Array<IstighfarSave | DayWrite> = [];
  const replies: Array<(failure?: Error) => void> = [];
  function reply(apply: () => NasrDay) {
    return new Promise<NasrDay>((resolve, reject) => {
      replies.push((failure) => (failure ? reject(failure) : resolve(apply())));
    });
  }
  const istighfar = new MutationObserver(client, {
    ...istighfarMutationOptions(client),
    mutationFn: (save: IstighfarSave) => {
      sent.push(save);
      return reply(() => {
        const day = { ...server.get(save.date)!, ...save };
        server.set(save.date, day);
        return day;
      });
    },
  });
  const writes = new MutationObserver(client, {
    ...dayWriteMutationOptions(client),
    mutationFn: (write: DayWrite) => {
      sent.push(write);
      return reply(() => {
        const day = applyDayWrite(server.get(write.data.date)!, write);
        server.set(write.data.date, day);
        return day;
      });
    },
  });
  for (const day of [date, dayBefore])
    client.setQueryData(nasrKeys.day(day), emptyDay(day));
  const cachedCount = (day: string) =>
    client.getQueryData<NasrDay>(nasrKeys.day(day))!.istighfar_count;
  // The Today page's Istighfar tap.
  const tap = (day: string, step: number) => {
    const save = nextIstighfarSave(client, day, step);
    if (save) void istighfar.mutate(save).catch(() => {});
  };
  // The Today page's guide tick: the opposite of what the day shows now.
  const tick = (day: string, id: string) => {
    const current = currentNasrDay(client, day)!;
    void writes
      .mutate({
        kind: "tick",
        data: { date: day, item_id: id, done: !current.adhkar_ticks.includes(id) },
      })
      .catch(() => {});
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  // Answer each write as the queue sends it.
  const answer = async (count: number, failure?: Error) => {
    for (let i = 0; i < count; i++) {
      await settle();
      replies.shift()!(failure);
    }
    await settle();
  };
  // The page's alerts.
  const shownError = (mutationKey: readonly string[]) =>
    saveFailure(
      client.getMutationCache().findAll({ mutationKey }).map(writeOutcome),
    );
  const invalidated = (day: string) =>
    client.getQueryState(nasrKeys.day(day))?.isInvalidated ?? false;
  return {
    client,
    server,
    sent,
    tap,
    tick,
    answer,
    cachedCount,
    shownError,
    invalidated,
  };
}

describe("applyDayWrite", () => {
  it("matches what the server stores for each write", () => {
    const store = new NasrStore(":memory:");
    const morning = adhkarItemIds("morning_adhkar");
    const evening = adhkarItemIds("evening_adhkar");
    const [sihr] = optionalItemIds("ruqyah");
    const writes: DayWrite[] = [
      { kind: "update", data: { date, fajr: "ontime", night_baqarah: true } },
      { kind: "tick", data: { date, item_id: morning[0]!, done: true } },
      ...morning.slice(1).map(
        (id): DayWrite => ({ kind: "tick", data: { date, item_id: id, done: true } }),
      ),
      { kind: "update", data: { date, evening_adhkar: true } },
      { kind: "tick", data: { date, item_id: evening[0]!, done: false } },
      { kind: "tick", data: { date, item_id: sihr!, done: true } },
      { kind: "update", data: { date, ruqyah: true } },
      { kind: "update", data: { date, ruqyah: false, fajr: null } },
      { kind: "update", data: { date, morning_adhkar: false } },
    ];
    let day = store.day(date);
    for (const write of writes) {
      day = applyDayWrite(day, write);
      const stored =
        write.kind === "tick"
          ? store.setAdhkarItem(write.data)
          : store.upsertDay(write.data);
      expect(day).toEqual(stored);
    }
  });
});

describe("Nasr day writes", () => {
  it("show and build on unsaved ticks when a refetch lands mid-run", async () => {
    const { client, sent, tick, answer } = setup();
    const [first, second] = adhkarItemIds("morning_adhkar");
    tick(date, first!);
    tick(date, second!);
    await answer(1);
    // A refetch lands with only the first tick stored.
    client.setQueryData(nasrKeys.day(date), {
      ...emptyDay(date),
      adhkar_ticks: [first!],
    });
    expect(currentNasrDay(client, date)!.adhkar_ticks).toEqual([first, second]);

    // A second tap on the same item clears it, rather than ticking it again.
    tick(date, second!);
    await answer(2);
    expect(sent.map((write) => "kind" in write && write.data)).toEqual([
      { date, item_id: first, done: true },
      { date, item_id: second, done: true },
      { date, item_id: second, done: false },
    ]);
    expect(client.getQueryData<NasrDay>(nasrKeys.day(date))!.adhkar_ticks).toEqual([
      first,
    ]);
  });

  it("refetch once the day has no writes of either kind left", async () => {
    const { tap, tick, answer, invalidated } = setup();
    const [first] = adhkarItemIds("evening_adhkar");
    tick(date, first!);
    tap(date, 1);
    await answer(1);
    // The tick has saved but the Istighfar save behind it has not.
    expect(invalidated(date)).toBe(false);
    await answer(1);
    expect(invalidated(date)).toBe(true);
  });

  it("keep a failed write's alert after the run moves to another day", async () => {
    const { tick, answer, shownError } = setup();
    const [first, second] = adhkarItemIds("morning_adhkar");
    tick(date, first!);
    tick(dayBefore, first!);
    await answer(1, new Error("offline"));
    expect(shownError(dayWriteMutationKey)?.message).toBe("offline");
    await answer(1);
    expect(shownError(dayWriteMutationKey)?.message).toBe("offline");

    tick(date, second!);
    await answer(1);
    expect(shownError(dayWriteMutationKey)).toBeNull();
  });
});

describe("Istighfar saves", () => {
  it("build on the newest unsaved tap when a refetch lowers the cached day mid-run", async () => {
    const { client, sent, tap, answer, cachedCount } = setup();
    tap(date, 1);
    tap(date, 1);
    tap(date, 1);
    await answer(1);
    // The queue sends one save at a time.
    expect(sent).toEqual([
      { date, istighfar_count: 1 },
      { date, istighfar_count: 2 },
    ]);

    // Another save's refetch lands with only the first tap stored.
    client.setQueryData(nasrKeys.day(date), {
      ...emptyDay(date),
      istighfar_count: 1,
    });
    expect(pendingIstighfarCount(client, date)).toBe(3);

    tap(date, 1);
    await answer(3);
    expect(sent.map((save) => "istighfar_count" in save && save.istighfar_count)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(pendingIstighfarCount(client, date)).toBeUndefined();
    expect(cachedCount(date)).toBe(4);
  });

  it("leave a day's newest saved count in its cache when the run moves to another day", async () => {
    const { client, tap, answer, cachedCount, invalidated } = setup();
    tap(date, 1);
    tap(date, 1);
    // The page moves to the day before and taps there before today's saves finish.
    tap(dayBefore, 1);
    await answer(2);

    expect(pendingIstighfarCount(client, date)).toBeUndefined();
    expect(pendingIstighfarCount(client, dayBefore)).toBe(1);
    expect(cachedCount(date)).toBe(2);
    expect(invalidated(date)).toBe(true);

    // Back on today, the next tap builds on 2, not on the count before the run.
    tap(date, 1);
    await answer(2);
    expect(cachedCount(date)).toBe(3);
    expect(cachedCount(dayBefore)).toBe(1);
  });

  it("keep a failed save's alert after the run moves to another day", async () => {
    const { tap, answer, shownError } = setup();
    tap(date, 1);
    tap(dayBefore, 1);
    await answer(1, new Error("offline"));
    expect(shownError(istighfarMutationKey)?.message).toBe("offline");

    // The other day's save succeeding does not clear today's failure.
    await answer(1);
    expect(shownError(istighfarMutationKey)?.message).toBe("offline");

    // A later save on today stores the full count again.
    tap(date, 1);
    await answer(1);
    expect(shownError(istighfarMutationKey)).toBeNull();
  });
});

describe("latestIstighfarCount", () => {
  it("takes the newest save for the day and ignores other days", () => {
    const saves = [
      { date, istighfar_count: 5 },
      { date: dayBefore, istighfar_count: 9 },
      undefined,
    ];
    expect(latestIstighfarCount(saves, date)).toBe(5);
    expect(latestIstighfarCount(saves, "2026-11-19")).toBeUndefined();
  });
});

import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { emptyDay, type NasrDay } from "@/lib/nasr";
import {
  istighfarMutationKey,
  istighfarMutationOptions,
  istighfarOutcome,
  istighfarSaveError,
  latestIstighfarCount,
  nasrKeys,
  nextIstighfarSave,
  pendingIstighfarCount,
  type IstighfarSave,
} from "./nasr";

const date = "2026-11-21";
const dayBefore = "2026-11-20";

function setup() {
  const client = new QueryClient();
  const sent: IstighfarSave[] = [];
  const replies: Array<(failure?: Error) => void> = [];
  // The page's options, with the server call replaced by one the test answers.
  const observer = new MutationObserver(client, {
    ...istighfarMutationOptions(client),
    mutationFn: (save: IstighfarSave) => {
      sent.push(save);
      return new Promise<NasrDay>((resolve, reject) => {
        replies.push((failure) =>
          failure ? reject(failure) : resolve({ ...emptyDay(save.date), ...save }),
        );
      });
    },
  });
  for (const day of [date, dayBefore])
    client.setQueryData(nasrKeys.day(day), emptyDay(day));
  const cachedCount = (day: string) =>
    client.getQueryData<NasrDay>(nasrKeys.day(day))!.istighfar_count;
  // The Today page's tap.
  const tap = (day: string, step: number) => {
    const save = nextIstighfarSave(client, day, step);
    if (save) void observer.mutate(save).catch(() => {});
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  // Answer each save as the scope sends it.
  const answer = async (count: number, failure?: Error) => {
    for (let i = 0; i < count; i++) {
      await settle();
      replies.shift()!(failure);
    }
    await settle();
  };
  // The page's alert.
  const shownError = () =>
    istighfarSaveError(
      client
        .getMutationCache()
        .findAll({ mutationKey: istighfarMutationKey })
        .map(istighfarOutcome),
    );
  return { client, sent, tap, answer, cachedCount, shownError };
}

describe("Istighfar saves", () => {
  it("build on the newest unsaved tap when a refetch lowers the cached day mid-run", async () => {
    const { client, sent, tap, answer, cachedCount } = setup();
    tap(date, 1);
    tap(date, 1);
    tap(date, 1);
    await answer(1);
    // The scope sends one save at a time.
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
    expect(sent.map((save) => save.istighfar_count)).toEqual([1, 2, 3, 4]);
    expect(pendingIstighfarCount(client, date)).toBeUndefined();
    expect(cachedCount(date)).toBe(4);
  });

  it("leave a day's newest saved count in its cache when the run moves to another day", async () => {
    const { client, tap, answer, cachedCount } = setup();
    tap(date, 1);
    tap(date, 1);
    // The page moves to the day before and taps there before today's saves finish.
    tap(dayBefore, 1);
    await answer(2);

    expect(pendingIstighfarCount(client, date)).toBeUndefined();
    expect(pendingIstighfarCount(client, dayBefore)).toBe(1);
    expect(cachedCount(date)).toBe(2);
    expect(client.getQueryState(nasrKeys.day(date))?.isInvalidated).toBe(true);

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
    expect(shownError()?.message).toBe("offline");

    // The other day's save succeeding does not clear today's failure.
    await answer(1);
    expect(shownError()?.message).toBe("offline");

    // A later save on today stores the full count again.
    tap(date, 1);
    await answer(1);
    expect(shownError()).toBeNull();
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

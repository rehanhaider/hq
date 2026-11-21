import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { emptyDay, type NasrDay } from "@/lib/nasr";
import {
  istighfarMutationOptions,
  latestIstighfarCount,
  nasrKeys,
  pendingIstighfarCount,
  type IstighfarSave,
} from "./nasr";

const date = "2026-11-21";
const dayBefore = "2026-11-20";

function setup() {
  const client = new QueryClient();
  const sent: IstighfarSave[] = [];
  const replies: Array<() => void> = [];
  // The page's options, with the server call replaced by one the test answers.
  const observer = new MutationObserver(client, {
    ...istighfarMutationOptions(client),
    mutationFn: (save: IstighfarSave) => {
      sent.push(save);
      return new Promise<NasrDay>((resolve) => {
        replies.push(() => resolve({ ...emptyDay(save.date), ...save }));
      });
    },
  });
  for (const day of [date, dayBefore])
    client.setQueryData(nasrKeys.day(day), emptyDay(day));
  const cachedCount = (day: string) =>
    client.getQueryData<NasrDay>(nasrKeys.day(day))!.istighfar_count;
  // The Today page's tap: build on the newest unsaved tap, else the day.
  const tap = (day: string, step: number) => {
    const current = pendingIstighfarCount(client, day) ?? cachedCount(day);
    void observer.mutate({ date: day, istighfar_count: current + step });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  // Answer each save as the scope sends it.
  const answer = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await settle();
      replies.shift()!();
    }
    await settle();
  };
  return { client, sent, tap, answer, cachedCount };
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

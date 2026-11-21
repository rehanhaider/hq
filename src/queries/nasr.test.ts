import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  istighfarMutationKey,
  latestIstighfarCount,
  nasrKeys,
  pendingIstighfarCount,
  type IstighfarSave,
} from "./nasr";

const date = "2026-11-21";

function setup() {
  const client = new QueryClient();
  const sent: IstighfarSave[] = [];
  const replies: Array<() => void> = [];
  const observer = new MutationObserver(client, {
    mutationKey: istighfarMutationKey,
    scope: { id: "nasr-istighfar" },
    mutationFn: (save: IstighfarSave) => {
      sent.push(save);
      return new Promise<IstighfarSave>((resolve) => {
        replies.push(() => resolve(save));
      });
    },
  });
  client.setQueryData(nasrKeys.day(date), { date, istighfar_count: 0 });
  // The Today page's tap: build on the newest unsaved tap, else the day.
  const tap = (step: number) => {
    const cached = client.getQueryData<IstighfarSave>(nasrKeys.day(date));
    const current =
      pendingIstighfarCount(client, date) ?? cached!.istighfar_count;
    void observer.mutate({ date, istighfar_count: current + step });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { client, sent, replies, tap, settle };
}

describe("pending Istighfar taps", () => {
  it("build on the newest unsaved tap when a refetch lowers the cached day mid-run", async () => {
    const { client, sent, replies, tap, settle } = setup();
    tap(1);
    tap(1);
    tap(1);
    await settle();
    // The scope sends one save at a time.
    expect(sent).toEqual([{ date, istighfar_count: 1 }]);

    replies[0]!();
    await settle();
    // Another save's refetch lands with only the first tap stored.
    client.setQueryData(nasrKeys.day(date), { date, istighfar_count: 1 });
    expect(pendingIstighfarCount(client, date)).toBe(3);

    tap(1);
    for (let i = 1; i < 4; i++) {
      await settle();
      replies[i]!();
    }
    await settle();
    expect(sent.map((save) => save.istighfar_count)).toEqual([1, 2, 3, 4]);
    expect(pendingIstighfarCount(client, date)).toBeUndefined();
  });
});

describe("latestIstighfarCount", () => {
  it("takes the newest save for the day and ignores other days", () => {
    const saves = [
      { date, istighfar_count: 5 },
      { date: "2026-11-20", istighfar_count: 9 },
      undefined,
    ];
    expect(latestIstighfarCount(saves, date)).toBe(5);
    expect(latestIstighfarCount(saves, "2026-11-19")).toBeUndefined();
  });
});

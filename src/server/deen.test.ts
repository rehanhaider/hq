import { afterEach, describe, expect, it } from "vitest";
import { DeenStore } from "./deen";

let store: DeenStore;
afterEach(() => store?.close());

describe("deen store", () => {
  it("leaves untouched fields alone and can clear a prayer", () => {
    store = new DeenStore(":memory:");
    store.upsertDay({ date: "2026-01-01", fajr: "ontime", ruqyah: true });
    const merged = store.upsertDay({ date: "2026-01-01", dhuhr: "qada" });
    expect(merged.fajr).toBe("ontime");
    expect(merged.dhuhr).toBe("qada");
    expect(merged.ruqyah).toBe(true);
    const cleared = store.upsertDay({ date: "2026-01-01", fajr: null });
    expect(cleared.fajr).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { DEEN_CONTENT, DEEN_GUIDES } from "./content";
import { deenContentSchema } from "./schemas";

describe("deen content reference", () => {
  it("contains valid, uniquely keyed content rows", () => {
    const ids = DEEN_CONTENT.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of DEEN_CONTENT)
      expect(deenContentSchema.parse(item)).toEqual(item);
  });
  it("gives every supported guide at least one referenced item", () => {
    for (const itemKey of Object.keys(DEEN_GUIDES)) {
      const items = DEEN_CONTENT.filter((item) => item.item_key === itemKey);
      expect(items.length, itemKey).toBeGreaterThan(0);
      expect(items.every((item) => item.reference.length > 0)).toBe(true);
      expect(
        items.every((item) =>
          ["sahih", "hasan", "mawquf"].includes(item.grade),
        ),
      ).toBe(true);
    }
  });
  it("keeps Ayat al-Kursi at one repetition in morning and evening", () => {
    const items = DEEN_CONTENT.filter(
      (item) =>
        ["morning_adhkar", "evening_adhkar"].includes(item.item_key) &&
        item.title.startsWith("Ayat al-Kursi"),
    );
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.repetitions === "Once")).toBe(true);
  });
  it("keeps all three night practices visible", () => {
    const night = DEEN_CONTENT.filter((item) => item.item_key === "night_ayat");
    expect(night.some((item) => item.id === "night-kursi")).toBe(true);
    expect(night.some((item) => item.id === "night-baqarah")).toBe(true);
    expect(night.filter((item) => item.id.startsWith("night-sura-"))).toHaveLength(
      3,
    );
  });
});

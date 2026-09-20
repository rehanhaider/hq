import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./PropertyPanel.tsx", import.meta.url)),
  "utf8",
);
// The subpage panel is the whole branch taken before the page panel is built.
const subpagePanel = source.slice(
  source.indexOf("if (isSubpage(page))"),
  source.indexOf('<Row icon={<CircleDashed />} label="Status">'),
);

describe("subpage properties", () => {
  it("offers the subpage type list, and only that list", () => {
    expect(subpagePanel).toMatch(/properties\.subpageTypes\.map\(\(option\) => \(/);
    expect(subpagePanel).toMatch(/selected=\{option\.id === page\.subpageTypeId\}/);
    expect(subpagePanel).toMatch(/onChange\(\{ subpageTypeId: option\.id \}\)/);
    // A subpage is not a step in the publishing pipeline, so neither the
    // statuses — where Idea lives — nor the page types are offered on it.
    expect(subpagePanel).not.toMatch(/properties\.statuses/);
    expect(subpagePanel).not.toMatch(/properties\.types/);
    expect(subpagePanel).not.toMatch(/page\.typeIds/);
  });

  it("shows each option's glyph in the picker and beside the chosen type", () => {
    expect(subpagePanel).toMatch(/<SubpageTypeIcon\s+subpageTypeId=\{option\.id\}/);
    expect(subpagePanel).toMatch(/<SubpageTypeIcon\s+subpageTypeId=\{subpageType\.id\}/);
  });

  it("lets a subpage go back to having no type", () => {
    expect(subpagePanel).toMatch(/onChange\(\{ subpageTypeId: null \}\)/);
  });

  it("keeps the page panel on the page lists", () => {
    const pagePanel = source.slice(
      source.indexOf('<Row icon={<CircleDashed />} label="Status">'),
    );
    expect(pagePanel).toMatch(/properties\.statuses\.map/);
    expect(pagePanel).toMatch(/properties\.types\.map/);
    expect(pagePanel).not.toMatch(/subpageTypeId/);
  });
});

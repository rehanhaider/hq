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
    expect(subpagePanel).toMatch(/selected=\{page\.subpageTypeIds\.includes\(option\.id\)\}/);
    // A subpage is not a step in the publishing pipeline, so neither the
    // statuses — where Idea lives — nor the page types are offered on it.
    expect(subpagePanel).not.toMatch(/properties\.statuses/);
    expect(subpagePanel).not.toMatch(/properties\.types/);
    expect(subpagePanel).not.toMatch(/page\.typeIds/);
  });

  it("toggles a type in and out of the list, leaving the picker open for the next", () => {
    const select = subpagePanel.slice(
      subpagePanel.indexOf("onSelect={() => {"),
      subpagePanel.indexOf("{properties.subpageTypes.length === 0"),
    );
    expect(select).toMatch(
      /subpageTypeIds: page\.subpageTypeIds\.includes\(option\.id\)\s*\? page\.subpageTypeIds\.filter\(\(id\) => id !== option\.id\)\s*: \[\.\.\.page\.subpageTypeIds, option\.id\]/,
    );
    expect(select).not.toMatch(/close\(\)/);
  });

  it("shows each option's glyph in the picker and beside every chosen type", () => {
    expect(subpagePanel).toMatch(/<SubpageTypeIcon\s+subpageTypeIds=\{\[option\.id\]\}/);
    expect(subpagePanel).toMatch(/subpageTypes\.map\(\(type\) =>/);
    expect(subpagePanel).toMatch(/<SubpageTypeIcon\s+subpageTypeIds=\{\[type\.id\]\}/);
  });

  it("lets a subpage go back to having no type", () => {
    expect(subpagePanel).toMatch(/onChange\(\{ subpageTypeIds: \[\] \}\)/);
  });

  it("keeps the page panel on the page lists", () => {
    const pagePanel = source.slice(
      source.indexOf('<Row icon={<CircleDashed />} label="Status">'),
    );
    expect(pagePanel).toMatch(/properties\.statuses\.map/);
    expect(pagePanel).toMatch(/properties\.types\.map/);
    expect(pagePanel).not.toMatch(/subpageTypeIds/);
  });
});

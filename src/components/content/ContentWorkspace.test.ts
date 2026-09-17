import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./ContentWorkspace.tsx", import.meta.url)),
  "utf8",
);
const menu = source.slice(source.indexOf("function PageContextMenu"));
const sortable = source.slice(source.indexOf("function SortablePageRow"));

describe("Content page index context menu", () => {
  it("opens a context menu from a page name in the left menu", () => {
    expect(source).toMatch(
      /from "@\/components\/ui\/context-menu"/,
    );
    expect(menu).toMatch(/<ContextMenuTrigger className="block w-full">/);
    expect(menu).toMatch(/<FilePlus2 className="size-4" \/> New subpage/);
    expect(menu).toMatch(/page\.parentId === null/);
    expect(menu).toMatch(/onClick=\{\(\) => onFilterTree\(page\.id\)\}/);
    expect(menu).toMatch(/<ListFilter className="size-4" \/> Filter to this page/);
  });

  it("creates a subpage under the right-clicked page", () => {
    expect(menu).toMatch(/onClick=\{\(\) => onCreateSubpage\(page\.id\)\}/);
    expect(source).toMatch(
      /onCreateSubpage=\{\(id\) => void addPage\(id\)\}/,
    );
  });

  it("keeps the menu on both the flat list and the sortable tree", () => {
    expect(source).toMatch(/function PageIndexRow/);
    expect(source.indexOf("<PageContextMenu", source.indexOf("function PageIndexRow"))).toBeGreaterThan(-1);
    const sortableReturn = sortable.slice(sortable.indexOf("return ("));
    expect(sortableReturn).toMatch(/<PageContextMenu/);
    expect(sortableReturn).toMatch(
      /<div ref=\{setActivatorNodeRef\} \{\.\.\.attributes\} \{\.\.\.listeners\}>/,
    );
    expect(sortableReturn.indexOf("<PageContextMenu")).toBeLessThan(
      sortableReturn.indexOf("setActivatorNodeRef"),
    );
  });
});

describe("Content page tree loading", () => {
  it("only fetches the complete hierarchy for an active tree filter", () => {
    expect(source).toMatch(
      /const hierarchy = useQuery\(\{[\s\S]*?\.\.\.pagesQuery\(\),[\s\S]*?enabled: Boolean\(search\.tree\),[\s\S]*?\}\);/,
    );
  });

  it("shows hierarchy failures separately from an empty filter result", () => {
    expect(source).toMatch(/search\.tree && hierarchy\.isError/);
    expect(source).toMatch(/The page tree could not load\./);
    expect(source).toMatch(/onClick=\{\(\) => void hierarchy\.refetch\(\)\}/);
    expect(source).toMatch(/Reload pages/);
  });
});

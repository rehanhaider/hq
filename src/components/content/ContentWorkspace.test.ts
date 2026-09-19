import { describe, expect, it } from "vitest";
import {
  canSortIndex,
  pageRows,
  pageTree,
  reorderedSiblings,
} from "./ContentWorkspace";
import {
  contentSearchSchema,
  filterPageSearchResults,
  type ContentPage,
} from "@/lib/content";
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
    expect(menu).toMatch(/onClick=\{\(\) => onSetPinned\(page\.id, !page\.pinned\)\}/);
    expect(menu).toMatch(/\{page\.pinned \? "Unpin" : "Pin"\}/);
  });

  it("creates a subpage under the right-clicked page", () => {
    expect(menu).toMatch(/onClick=\{\(\) => onCreateSubpage\(page\.id\)\}/);
    expect(source).toMatch(
      /onCreateSubpage=\{\(id\) => void addPage\(id\)\}/,
    );
  });

  it("pins and unpins from the same menu", () => {
    expect(source).toMatch(/onSetPinned=\{setPinned\}/);
    expect(source).toMatch(/setPagePinned\(\{ data: \{ id, pinned \} \}\)/);
    expect(source).toMatch(
      /<Pin className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden \/>/,
    );
    expect(source).toMatch(/<span className="sr-only">Pinned<\/span>/);
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

describe("Content page index pins", () => {
  it("keeps pinned siblings above unpinned ones and refuses a drag across that line", () => {
    expect(source).toMatch(/siblings\.sort\(compareIndexPages\)/);
    expect(source).toMatch(/data: \{ parentId: page\.parentId, pinned: page\.pinned \}/);
    expect(source).toMatch(
      /data\?\.parentId === current\?\.parentId && data\?\.pinned === current\?\.pinned/,
    );
    expect(source).toMatch(/pages\.filter\(\(page\) => page\.pinned\)/);
    expect(source).toMatch(/pages\.filter\(\(page\) => !page\.pinned\)/);
  });
});

describe("Content page title save", () => {
  it("does not put the trimmed stored title back into the editor after a save", () => {
    expect(source).toMatch(
      /sequence === changed\.current\s+\? editorPageTitle\(draftRef\.current\.title, result\.page\.title\)/,
    );
    expect(source).not.toMatch(
      /title: sequence === changed\.current \? result\.page\.title/,
    );
  });

  it("trims the page title when the field loses focus without scheduling a save", () => {
    const commit = source.slice(
      source.indexOf("const commitPageTitle"),
      source.indexOf("useEffect", source.indexOf("const commitPageTitle")),
    );
    expect(source).toMatch(/onBlur=\{commitPageTitle\}/);
    expect(commit).toMatch(/persistedPageTitle\(current\.title\)/);
    expect(commit).not.toMatch(/scheduleSave/);
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

describe("Content page index reorder under a tree filter", () => {
  // The tree filter only survives the search schema as a real id.
  const id = (name: string) =>
    `00000000-0000-4000-8000-${name.padStart(12, "0")}`;
  const page = (name: string, overrides: Partial<ContentPage> = {}): ContentPage => ({
    id: id(name),
    title: name,
    parentId: null,
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    revision: 0,
    preview: "",
    statusId: null,
    typeIds: [],
    tagIds: [],
    position: 0,
    pinned: false,
    ...overrides,
  });
  // One filtered top-level page with three subpages, plus a page the filter
  // hides, so a drag that leaked outside the filtered tree would show up.
  const root = page("1");
  const first = page("11", { parentId: id("1"), order: 0 });
  const second = page("12", { parentId: id("1"), order: 1 });
  const third = page("13", { parentId: id("1"), order: 2 });
  const elsewhere = page("2", { order: 1 });
  const pages = [root, first, second, third, elsewhere];
  const filtered = (tree: string, rest: Record<string, unknown> = {}) =>
    filterPageSearchResults(
      pages,
      pages,
      contentSearchSchema.parse({ tree, ...rest }),
    );

  it("keeps the filtered index sortable", () => {
    expect(canSortIndex(pageTree(filtered(root.id), root.id), false)).toBe(true);
    // The gate is the siblings a search or a property filter hides, not the
    // tree filter.
    expect(canSortIndex(pageTree(filtered(root.id), root.id), true)).toBe(false);
  });

  it("saves the whole sibling group when a subpage is dragged", () => {
    const move = reorderedSiblings(
      pageTree(filtered(root.id), root.id),
      third,
      first.id,
    );
    expect(move?.orderedIds).toEqual([third.id, first.id, second.id]);
    // The group is dealt the display orders it already held, so the page the
    // filter hides keeps an order nothing collides with.
    expect([...(move?.orderOf ?? [])]).toEqual([
      [third.id, 0],
      [first.id, 1],
      [second.id, 2],
    ]);
  });

  it("indents the filtered tree and refuses a drop beside the filtered page", () => {
    expect(
      pageRows(filtered(root.id), false, root.id).map((row) => [row.page.id, row.depth]),
    ).toEqual([
      [root.id, 0],
      [first.id, 1],
      [second.id, 1],
      [third.id, 1],
    ]);
    // The filtered page's own siblings are off screen, so it has nowhere to go.
    expect(
      reorderedSiblings(pageTree(filtered(root.id), root.id), root, elsewhere.id),
    ).toBeNull();
  });

  it("re-roots a filter on a subpage so its children still sort", () => {
    const grandchild = page("111", { parentId: first.id, order: 0 });
    const sibling = page("112", { parentId: first.id, order: 1 });
    const all = [...pages, grandchild, sibling];
    const nested = filterPageSearchResults(
      all,
      all,
      contentSearchSchema.parse({ tree: first.id }),
    );
    const tree = pageTree(nested, first.id);
    expect(tree.orphans).toEqual([]);
    expect(
      pageRows(nested, false, first.id).map((row) => [row.page.id, row.depth]),
    ).toEqual([
      [first.id, 0],
      [grandchild.id, 1],
      [sibling.id, 1],
    ]);
    expect(canSortIndex(tree, false)).toBe(true);
    expect(reorderedSiblings(tree, sibling, grandchild.id)?.orderedIds).toEqual([
      sibling.id,
      grandchild.id,
    ]);
  });

  it("does not gate the sortable index on the tree filter", () => {
    const gate = source.slice(
      source.indexOf("const canReorder ="),
      source.indexOf("const draggedPage"),
    );
    expect(gate).not.toMatch(/search\.tree/);
    expect(source).toMatch(/pageTree\(visiblePages, treeRootId\)/);
  });
});

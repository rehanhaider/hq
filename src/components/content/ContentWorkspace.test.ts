import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  canSortIndex,
  COLLAPSED_PAGES_KEY,
  countDescendants,
  expandAncestors,
  isInSubtree,
  pageRows,
  pageTree,
  readCollapsedPages,
  reorderedSiblings,
  toggleCollapsedPage,
  writeCollapsedPages,
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
    expect(menu).toMatch(/<Trash2 className="size-4" \/> Delete/);
    expect(menu).toMatch(/onClick=\{\(\) => onDelete\(page\)\}/);
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
      /<div ref=\{setActivatorNodeRef\} \{\.\.\.attributes\} \{\.\.\.listeners\}[^>]*>/,
    );
    expect(sortableReturn.indexOf("<PageContextMenu")).toBeLessThan(
      sortableReturn.indexOf("setActivatorNodeRef"),
    );
  });

  it("offers Delete on both the flat list and the sortable tree", () => {
    expect(source).toMatch(/onDelete=\{\(page\) => setDeletingPage\(page\)\}/);
    expect(source.slice(source.indexOf("function PageIndexRow"))).toMatch(
      /onDelete=\{onDelete\}/,
    );
    expect(sortable).toMatch(/onDelete=\{onDelete\}/);
  });
});

describe("Content page index delete", () => {
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
    subpageTypeIds: [],
    position: 0,
    pinned: false,
    ...overrides,
  });

  it("counts the whole subtree for the confirmation", () => {
    const root = page("1");
    const child = page("11", { parentId: id("1") });
    const grandchild = page("111", { parentId: id("11") });
    const sibling = page("2");
    const pages = [root, child, grandchild, sibling];
    expect(countDescendants(pages, root.id)).toBe(2);
    expect(countDescendants(pages, child.id)).toBe(1);
    expect(countDescendants(pages, sibling.id)).toBe(0);
  });

  it("treats the open editor inside the trashed subtree as affected", () => {
    const root = page("1");
    const child = page("11", { parentId: id("1") });
    const grandchild = page("111", { parentId: id("11") });
    const elsewhere = page("2");
    const pages = [root, child, grandchild, elsewhere];
    expect(isInSubtree(pages, root.id, root.id)).toBe(true);
    expect(isInSubtree(pages, child.id, root.id)).toBe(true);
    expect(isInSubtree(pages, grandchild.id, root.id)).toBe(true);
    expect(isInSubtree(pages, elsewhere.id, root.id)).toBe(false);
    expect(isInSubtree(pages, root.id, child.id)).toBe(false);
  });

  it("asks for confirmation before anything is removed", () => {
    expect(source).toMatch(/const \[deletingPage, setDeletingPage\] = useState<ContentPage \| null>\(null\)/);
    expect(source).toMatch(/open=\{deletingPage !== null\}/);
    expect(source).toMatch(/displayPageTitle\(deletingPage\.title\)/);
    expect(source).toMatch(/You can restore it from Trash\./);
    expect(source).toMatch(/You can restore them from Trash\./);
    // Cancel leaves the item intact: closing the dialog or pressing Cancel
    // only clears the pending page, never calls the server.
    expect(source).toMatch(/onClick=\{\(\) => setDeletingPage\(null\)\}/);
    expect(source).toMatch(/if \(!open && !deleteBusy\) setDeletingPage\(null\)/);
  });

  it("counts the cascade from the unfiltered list, never the filtered rows", () => {
    // A search hides the subpages a delete still takes with it, so the count
    // loads the unfiltered list while the dialog is open.
    expect(source).toMatch(
      /queryClient\s*\n?\s*\.fetchQuery\(pagesQuery\(\)\)/,
    );
    expect(source).toMatch(/\[deletingPage, queryClient\]/);
    // Until that list lands the dialog uses copy that never undercounts.
    expect(source).toMatch(
      /This page and its subpages will be moved to trash\. You can restore them from Trash\./,
    );
    expect(source).toMatch(/deleteChildCount === null/);
  });

  it("locks the dialog before any await so cancel cannot slip through", () => {
    const confirm = source.slice(source.indexOf("const confirmIndexDelete"));
    // The guard arms synchronously: a second confirm returns early and Cancel
    // is disabled before drain or the scope fetch yields.
    expect(confirm).toMatch(/if \(!target \|\| recoveringRef\.current \|\| deleteBusyRef\.current\) return;/);
    expect(confirm.indexOf("deleteBusyRef.current = true;")).toBeLessThan(
      confirm.indexOf("await drain()"),
    );
    // A failed drain releases the lock with the dialog still open.
    expect(confirm).toMatch(
      /if \(\!\(await drain\(\)\)\) \{\s+deleteBusyRef\.current = false;\s+setDeleteBusy\(false\);\s+return;\s+\}/,
    );
  });

  it("moves the confirmed page to trash and refreshes the index", () => {
    expect(source).toMatch(
      /await trashPage\(\{ data: \{ id: target\.id, revision: freshRevision \} \}\)/,
    );
    expect(source).toMatch(/await invalidateContent\(queryClient, contentKeys\.all\)/);
    expect(source).toMatch(/setLocalPages\(null\)/);
    // The editor redirect walks the unfiltered scope, falling back to the
    // rows on screen only when that fetch fails.
    expect(source).toMatch(/let scope = deleteScope;/);
    expect(source).toMatch(/isInSubtree\(\[\.\.\.known\.values\(\)\], selectedId, target\.id\)/);
    // The scope is snapshotted before trashing: afterwards the trashed rows
    // are excluded from list results and the walk could no longer reach them.
    expect(
      source.indexOf("scope = await queryClient.fetchQuery(pagesQuery())"),
    ).toBeLessThan(source.indexOf("await trashPage({ data: { id: target.id"));
    expect(source).toMatch(
      /This page changed before it could be deleted\. The list has been refreshed\./,
    );
    expect(source).toMatch(/The page could not be deleted\./);
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

describe("Content property saves", () => {
  it("sends one property save at a time, in the order they were made", () => {
    const apply = source.slice(
      source.indexOf("const applyProperties = async"),
      source.indexOf("const addTag = async"),
    );
    // Each save waits for the one before it, so an older list can never land
    // after a newer one from the same open picker.
    expect(apply).toMatch(/const queued = propertySaves\.current\.then\(save\);/);
    expect(apply).toMatch(/propertySaves\.current = queued;/);
    expect(apply).toMatch(/await queued;/);
    expect(apply.slice(apply.indexOf("const save = async"))).toMatch(
      /await setPageProperties\(/,
    );
  });
});

describe("Content page index icons", () => {
  it("draws every row from the list the page itself is typed by", () => {
    const row = source.slice(source.indexOf("function PageIndexLink"));
    expect(row).toMatch(/<PageIcon page=\{page\} properties=\{properties\} \/>/);
    // The open page's icon follows the picker before the list is refetched.
    expect(source).toMatch(/subpageTypeIds: draft\.subpageTypeIds/);
  });
});

describe("Content page index rows", () => {
  const row = source.slice(
    source.indexOf("function PageIndexLink"),
    source.indexOf("function CollapseToggle"),
  );

  it("renders each row as a link so a click before hydration navigates", () => {
    expect(row).toMatch(/<Link\n\s+to="\/content"/);
    expect(row).toMatch(/search=\{\(prev\) => \(\{ \.\.\.prev, page: page\.id \}\)\}/);
    expect(row).toMatch(/preload="intent"/);
    expect(row).not.toMatch(/<button/);
  });

  it("keeps the selected row marked as the current page", () => {
    expect(row).toMatch(/aria-current=\{selected \? "page" : undefined\}/);
  });

  it("carries no click handler: leaving is the blocker's job, not the row's", () => {
    expect(row).not.toMatch(/onClick/);
    expect(row).not.toMatch(/preventDefault/);
    expect(row).not.toMatch(/onSelect/);
  });

  it("disables the link itself during recovery so no href or preload remains", () => {
    expect(row).toMatch(/disabled=\{disabled\}/);
    expect(row).not.toMatch(/aria-disabled/);
  });

  it("stops the native link drag so a row can still be reordered", () => {
    expect(row).toMatch(/draggable=\{false\}/);
  });
});

describe("Content leaving a page with unsaved text", () => {
  const effect = source.slice(
    source.indexOf("const blocker = useBlocker("),
    source.indexOf("// The server already searched titles"),
  );

  it("blocks every navigation away from unsaved text, not just a row click", () => {
    expect(effect).toMatch(/enableBeforeUnload: \(\) => hasUnsaved/);
    expect(effect).toMatch(/withResolver: true/);
    expect(effect).toMatch(
      /hasUnsaved && \(current\.pathname !== next\.pathname \|\| currentPage !== nextPage\)/,
    );
  });

  it("drains the pending saves and then resumes the held navigation", () => {
    expect(effect).toMatch(/if \(blocker\.status !== "blocked"\)/);
    expect(effect).toMatch(/void drain\(\)\.then\(\(saved\) => \{/);
    expect(effect).toMatch(/if \(saved\) proceed\(\);/);
    expect(effect.indexOf("void drain()")).toBeLessThan(effect.indexOf("proceed()"));
  });

  it("runs the drain once per block and never resumes a stale one", () => {
    expect(effect).toMatch(/if \(drainAttempt\.current === blocker\) return;/);
    expect(effect).toMatch(/drainAttempt\.current = blocker;/);
    expect(effect).toMatch(/if \(drainAttempt\.current !== blocker\) return;/);
    // Leaving the blocked state, and unmounting, both drop the attempt.
    expect(effect).toMatch(/drainAttempt\.current = null;\n\s+setDrainFailed\(false\);/);
    expect(effect).toMatch(
      /useEffect\(\(\) => \(\) => \{\s+drainAttempt\.current = null;\s+\}, \[\]\);/,
    );
  });

  it("leaves the drain to the blocker and keeps the draft guarded meanwhile", () => {
    const select = source.slice(
      source.indexOf("const selectPage ="),
      source.indexOf("const addPage ="),
    );
    expect(select).toMatch(
      /const selectPage = async \(page: string \| undefined\) => \{\s+if \(recoveringRef\.current \|\| page === selectedId\) return;\s+await navigate\(/,
    );
    expect(select).not.toMatch(/drain\(\)/);
    // A blocked navigation has not moved the selection and may never move it,
    // so the caller must not drop the guard that stops fresh detail from
    // overwriting the unsaved draft. Only an actual selection change does.
    expect(select).not.toMatch(/loadedId/);
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s+if \(loadedId\.current !== selectedId\) loadedId\.current = null;\s+\}, \[selectedId\]\);/,
    );
    const add = source.slice(
      source.indexOf("const addPage ="),
      source.indexOf("const addPageRef"),
    );
    expect(add).not.toMatch(/loadedId/);
    // The mobile back arrow and the empty-state link go through selectPage,
    // so they are blocked and drained like every other way out.
    expect(source).toMatch(
      /aria-label="Back to page list" onClick=\{\(\) => void selectPage\(undefined\)\}/,
    );
  });

  it("keeps the drains that guard a mutation rather than a navigation", () => {
    // A page created and then never reached, because the user stayed with a
    // failed save, would be an orphan in the index.
    const add = source.slice(
      source.indexOf("const addPage ="),
      source.indexOf("const addPageRef"),
    );
    expect(add.indexOf("await drain()")).toBeLessThan(add.indexOf("await createPage("));
    expect(add).toMatch(/if \(!\(await drain\(\)\)\) return;/);
    // Trashing persists the page's text before the page goes, and needs a
    // current revision to trash against.
    const confirm = source.slice(source.indexOf("const confirmIndexDelete"));
    expect(confirm).toMatch(/await drain\(\)/);
    expect(source).toMatch(
      /aria-label=\{`Move \$\{displayPageTitle\(draft\.title\)\} to trash`\} onClick=\{async \(\) => \{\s+if \(!\(await drain\(\)\)\) return;/,
    );
    // The failed-save banner retries the save on demand.
    expect(source).toMatch(/void drain\(\);\s+\}\}>\{recovering \? "Saving copy…"/);
  });

  it("only asks the user when the drain cannot succeed", () => {
    expect(effect).toMatch(/if \(saveConflict \|\| saveUnavailable \|\| recovering\) \{\s+setDrainFailed\(true\);/);
    expect(effect).toMatch(/else setDrainFailed\(true\);/);
    expect(source).toMatch(
      /open=\{blocker\.status === "blocked" && drainFailed\}/,
    );
    // Staying put leaves the navigation blocked and the text where it is.
    expect(source).toMatch(
      /if \(!open && blocker\.status === "blocked"\) blocker\.reset\(\)/,
    );
    expect(source).toMatch(/Overwrite and continue/);
    expect(source).toMatch(/Save copy and continue/);
    expect(source).toMatch(
      /if \(\(await drain\(\)\) && blocker\.status === "blocked"\) blocker\.proceed\(\)/,
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
    subpageTypeIds: [],
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

describe("Content page index collapse", () => {
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
    subpageTypeIds: [],
    position: 0,
    pinned: false,
    ...overrides,
  });

  it("folds one page's subtree out of the rows and unfolds it again", () => {
    const root = page("1");
    const child = page("11", { parentId: id("1"), order: 0 });
    const grandchild = page("111", { parentId: id("11"), order: 0 });
    const sibling = page("2", { order: 1 });
    const pages = [root, child, grandchild, sibling];
    expect(pageRows(pages, false).map((row) => row.page.id)).toEqual([
      root.id,
      child.id,
      grandchild.id,
      sibling.id,
    ]);
    expect(
      pageRows(pages, false, null, new Set([root.id])).map((row) => row.page.id),
    ).toEqual([root.id, sibling.id]);
    expect(
      pageRows(pages, false, null, new Set([child.id])).map((row) => row.page.id),
    ).toEqual([root.id, child.id, sibling.id]);
  });

  it("ignores the folded set while searching so every match stays reachable", () => {
    const root = page("1");
    const child = page("11", { parentId: id("1"), order: 0 });
    const pages = [root, child];
    expect(
      pageRows(pages, true, null, new Set([root.id])).map((row) => [
        row.page.id,
        row.depth,
      ]),
    ).toEqual([
      [root.id, 0],
      [child.id, 0],
    ]);
  });

  it("toggles one id with a stable order for storage", () => {
    expect(toggleCollapsedPage([], id("2"))).toEqual([id("2")]);
    expect(toggleCollapsedPage([id("2")], id("2"))).toEqual([]);
    expect(toggleCollapsedPage([id("2")], id("1"))).toEqual([id("1"), id("2")]);
  });

  it("remembers the folded ids across sessions and drops bad values", () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(readCollapsedPages(store)).toEqual([]);
    writeCollapsedPages([id("1")], store);
    expect(storage.get(COLLAPSED_PAGES_KEY)).toBe(JSON.stringify([id("1")]));
    expect(readCollapsedPages(store)).toEqual([id("1")]);
    storage.set(COLLAPSED_PAGES_KEY, "not json");
    expect(readCollapsedPages(store)).toEqual([]);
    storage.set(COLLAPSED_PAGES_KEY, JSON.stringify([id("1"), 42, null]));
    expect(readCollapsedPages(store)).toEqual([id("1")]);
    expect(readCollapsedPages(null)).toEqual([]);
  });

  it("unfolds the open page's ancestors so the selection stays visible", () => {
    const root = page("1");
    const child = page("11", { parentId: id("1") });
    const grandchild = page("111", { parentId: id("11") });
    const pages = [root, child, grandchild];
    expect([...ancestorIds(pages, grandchild.id)]).toEqual([child.id, root.id]);
    expect(expandAncestors([root.id, child.id], pages, grandchild.id)).toEqual([]);
    expect(expandAncestors([root.id, id("9")], pages, child.id)).toEqual([id("9")]);
    expect(expandAncestors([root.id], pages, undefined)).toEqual([root.id]);
  });

  it("renders a disclosure only for pages with subpages", () => {
    expect(source).toMatch(/function CollapseToggle/);
    expect(source).toMatch(/aria-expanded=\{expanded\}/);
    expect(source).toMatch(/Collapse.*subpages of/);
    expect(source).toMatch(/Expand.*subpages of/);
    // The toggle stops the pointer so unfolding never starts a drag.
    expect(source).toMatch(/onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    // A folded subtree renders no rows below it in either list.
    expect(source).toMatch(/if \(collapsed\?\.has\(page\.id\)\) continue;/);
    expect(source).toMatch(/\{collapsed\.has\(page\.id\) \? null : \(/);
  });

  it("persists the folded set in localStorage like the other sidebar UI", () => {
    expect(source).toMatch(/hq:content-collapsed-pages/);
    expect(source).toMatch(/readCollapsedPages\(localStorage\)/);
    expect(source).toMatch(/writeCollapsedPages\(collapsedIds, localStorage\)/);
  });
});

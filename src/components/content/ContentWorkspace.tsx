import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ClientOnly, useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, FilePlus2, FileText, ListFilter, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  compareIndexPages,
  DEFAULT_PAGE_TITLE,
  displayPageTitle,
  editorPageTitle,
  filterPageSearchResults,
  hasFilters,
  persistedPageTitle,
  splitTagNames,
  type ContentBlock,
  type ContentPage,
  type ContentProperties,
  type PageDetail,
} from "@/lib/content";
import { bookmarkUrlsFromDocument } from "@/lib/linkPreview";
import { tweetIdsFromDocument } from "@/lib/tweet";
import { createUploadGate } from "@/lib/uploads";
import {
  contentKeys,
  contentPropertiesQuery,
  invalidateContent,
  pageQuery,
  pagesQuery,
} from "@/queries/content";
import { linkPreviewQuery } from "@/queries/linkPreview";
import { tweetEmbedQuery } from "@/queries/tweet";
import {
  createContentProperty,
  createPage,
  movePage,
  savePage,
  setPagePinned,
  setPageProperties,
  trashPage,
} from "@/server/fns";
import { ContentToolbar, type ToolbarPatch } from "./ContentToolbar";
import { SearchBox } from "./SearchBox";
import { PageIcon } from "./PageTypeIcon";
import { PropertyPanel, type PropertyPatch } from "./PropertyPanel";
import { useUI } from "@/store/ui";

const ContentEditor = lazy(() =>
  import("./ContentEditor").then((module) => ({ default: module.ContentEditor })),
);

type SaveState = "saved" | "dirty" | "saving" | "error";

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (
    !message ||
    message.length > 240 ||
    message.startsWith("[") ||
    message.startsWith("{") ||
    message.includes('"code"')
  )
    return fallback;
  return message;
}

type PageTree = {
  /** Each sibling group in display order, keyed by parent; root is `null`. */
  children: Map<string | null, ContentPage[]>;
  /** Pages the root cannot reach (missing parent or a cycle). */
  orphans: ContentPage[];
};

/**
 * Groups the pages on screen by parent. When the index is filtered to one
 * page's tree, `rootId` stands in for the root: the filtered page's own
 * siblings are off screen, so it heads the top group alone and every group
 * below it is whole.
 */
export function pageTree(pages: ContentPage[], rootId: string | null = null): PageTree {
  const byParent = new Map<string | null, ContentPage[]>();
  for (const page of pages) {
    const parentId = page.id === rootId ? null : page.parentId;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(page);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort(compareIndexPages);
  // Only groups reachable from the root are kept, so a cycle can never recurse.
  const children = new Map<string | null, ContentPage[]>();
  const seen = new Set<string>();
  const visit = (parentId: string | null) => {
    const group = (byParent.get(parentId) ?? []).filter((page) => !seen.has(page.id));
    for (const page of group) seen.add(page.id);
    children.set(parentId, group);
    for (const page of group) visit(page.id);
  };
  visit(null);
  return { children, orphans: pages.filter((page) => !seen.has(page.id)) };
}

export function pageRows(
  pages: ContentPage[],
  searching: boolean,
  rootId: string | null = null,
) {
  if (searching) return pages.map((page) => ({ page, depth: 0 }));
  const { children, orphans } = pageTree(pages, rootId);
  const rows: { page: ContentPage; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      rows.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const page of orphans) rows.push({ page, depth: 0 });
  return rows;
}

/**
 * True when every sibling group on screen is whole, so a drag saves an order
 * the user could see: a search or a property filter hides siblings, while a
 * tree filter keeps each group below the filtered page complete. Sortable
 * needs at least one group with something to swap.
 */
export function canSortIndex(tree: PageTree, searching: boolean) {
  if (searching) return false;
  return [...tree.children.values()].some((group) => {
    const pinned = group.filter((page) => page.pinned).length;
    return pinned > 1 || group.length - pinned > 1;
  });
}

/**
 * The sibling order a drop produces, or null when it changes nothing. The
 * dragged page takes the hovered sibling's slot, downward moves landing past
 * it, exactly as the drag preview shows. Nesting never changes, and the group
 * keeps the display orders it already holds, so a sibling this drag did not
 * name cannot collide with it.
 */
export function reorderedSiblings(
  tree: PageTree,
  activePage: ContentPage,
  overId: string,
) {
  const siblings = (tree.children.get(activePage.parentId) ?? []).filter(
    (page) => page.pinned === activePage.pinned,
  );
  const from = siblings.findIndex((page) => page.id === activePage.id);
  const to = siblings.findIndex((page) => page.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const orderedIds = arrayMove(siblings, from, to).map((page) => page.id);
  const slots = siblings.map((page) => page.order).sort((a, b) => a - b);
  return {
    orderedIds,
    orderOf: new Map(orderedIds.map((id, index) => [id, slots[index]!])),
  };
}

// Only the dragged page's siblings can be dropped on. Nesting never changes
// here, so a nested row must not steal the drop: with siblings in their own
// SortableContext, the preview and the saved order are then the same list.
/**
 * Counts every page below the given id. Trashing moves the whole subtree, so
 * the delete confirmation names how many subpages go with the page.
 */
export function countDescendants(pages: ContentPage[], id: string) {
  const childrenOf = new Map<string | null, string[]>();
  for (const page of pages) {
    const list = childrenOf.get(page.parentId) ?? [];
    list.push(page.id);
    childrenOf.set(page.parentId, list);
  }
  let count = 0;
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    count += 1;
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return count;
}

/**
 * True when `pageId` is the ancestor itself or sits below it. After a trash
 * the index checks this to decide whether the open editor was inside the
 * removed subtree and should return to the list.
 */
export function isInSubtree(
  pages: ContentPage[],
  pageId: string,
  ancestorId: string,
) {
  if (pageId === ancestorId) return true;
  const byId = new Map(pages.map((page) => [page.id, page]));
  let current = byId.get(pageId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

const sameLevelCollision: CollisionDetection = (args) => {
  const current = args.active.data.current as
    | { parentId?: string | null; pinned?: boolean }
    | undefined;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const data = container.data.current as
        | { parentId?: string | null; pinned?: boolean }
        | undefined;
      return data?.parentId === current?.parentId && data?.pinned === current?.pinned;
    }),
  });
};

export function ContentWorkspace() {
  const search = useSearch({ from: "/content" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery(pagesQuery(search.q));
  const hierarchy = useQuery({
    ...pagesQuery(),
    enabled: Boolean(search.tree),
  });
  const propertyQuery = useQuery(contentPropertiesQuery);
  const properties: ContentProperties = propertyQuery.data ?? {
    statuses: [],
    types: [],
    tags: [],
    subpageTypes: [],
  };
  const selectedId = search.page;
  const detail = useQuery(pageQuery(selectedId ?? ""));
  const [draft, setDraft] = useState<PageDetail | null>(null);
  const draftRef = useRef<PageDetail | null>(null);
  const loadedId = useRef<string | null>(null);
  const changed = useRef(0);
  const saved = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainPromise = useRef<Promise<boolean> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [actionError, setActionError] = useState("");
  const [deletingPage, setDeletingPage] = useState<ContentPage | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteScope, setDeleteScope] = useState<ContentPage[] | null>(null);
  const staleRevision = useRef<number | null>(null);
  const recoveringRef = useRef(false);
  const uploads = useRef(createUploadGate()).current;
  const [uploadBusy, setUploadBusy] = useState(false);

  const onUploadStart = useCallback(() => {
    uploads.start();
    setUploadBusy(true);
  }, [uploads]);
  const onUploadEnd = useCallback(() => {
    uploads.end();
    setUploadBusy(uploads.busy);
  }, [uploads]);

  const applyFreshDetail = useCallback(
    (next: PageDetail) => {
      if (next.id !== selectedId) return false;
      const current = draftRef.current;
      const samePage = loadedId.current === next.id && current?.id === next.id;
      if (
        samePage &&
        (next.revision <= current.revision ||
          saved.current < changed.current ||
          drainPromise.current !== null ||
          uploads.busy ||
          recoveringRef.current)
      )
        return false;
      loadedId.current = next.id;
      draftRef.current = next;
      setDraft(next);
      if (samePage) setEditorGeneration((generation) => generation + 1);
      changed.current = 0;
      saved.current = 0;
      staleRevision.current = null;
      setSaveState("saved");
      setSaveError("");
      setSaveConflict(false);
      setSaveUnavailable(false);
      return true;
    },
    [selectedId],
  );

  useEffect(() => {
    if (!detail.data) return;
    applyFreshDetail(detail.data);
  }, [applyFreshDetail, detail.data]);

  const drain = useCallback(() => {
    if (recoveringRef.current) return Promise.resolve(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (drainPromise.current) return drainPromise.current;
    const work = (async () => {
      for (;;) {
        await uploads.idle();
        if (saved.current >= changed.current) {
          setSaveState("saved");
          return true;
        }
        const sequence = changed.current;
        const snapshot = draftRef.current;
        if (!snapshot) return true;
        setSaveState("saving");
        setSaveError("");
        try {
          const result = await savePage({
            data: {
              id: snapshot.id,
              title: persistedPageTitle(snapshot.title),
              revision: snapshot.revision,
              document: snapshot.document,
            },
          });
          if (!result.ok) {
            staleRevision.current = result.current?.revision ?? null;
            setSaveConflict(result.code === "stale");
            setSaveUnavailable(result.code === "trashed" || result.code === "missing");
            setSaveState("error");
            setSaveError(
              result.code === "trashed"
                ? "This page is in the trash. Your unsaved text is still here."
                : result.code === "missing"
                  ? "This page was removed. Your unsaved text is still here."
                : "This page changed in another tab. Your unsaved text is still here.",
            );
            return false;
          }
          if (draftRef.current?.id === snapshot.id) {
            const title =
              sequence === changed.current
                ? editorPageTitle(draftRef.current.title, result.page.title)
                : draftRef.current.title;
            draftRef.current = {
              ...draftRef.current,
              title,
              revision: result.page.revision,
              updatedAt: result.page.updatedAt,
            };
            setDraft((current) =>
              current?.id === snapshot.id
                ? {
                    ...current,
                    title,
                    revision: result.page.revision,
                    updatedAt: result.page.updatedAt,
                  }
                : current,
            );
          }
          saved.current = sequence;
          staleRevision.current = null;
          setSaveConflict(false);
          setSaveUnavailable(false);
          queryClient.setQueryData(contentKeys.detail(snapshot.id), result.page);
          void invalidateContent(queryClient);
        } catch (error) {
          setSaveConflict(false);
          setSaveUnavailable(false);
          setSaveState("error");
          setSaveError(
            readableError(
              error,
              "The page could not be saved. Your text is still here.",
            ),
          );
          return false;
        }
      }
    })();
    drainPromise.current = work;
    void work.finally(() => {
      if (drainPromise.current === work) drainPromise.current = null;
    });
    return work;
  }, [queryClient]);

  const scheduleSave = useCallback(
    (next: PageDetail) => {
      if (recoveringRef.current) return;
      draftRef.current = next;
      setDraft(next);
      changed.current += 1;
      setSaveState("dirty");
      setSaveError("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), 600);
    },
    [drain],
  );

  const commitPageTitle = useCallback(() => {
    const current = draftRef.current;
    if (!current || recoveringRef.current) return;
    const title = persistedPageTitle(current.title);
    if (title === current.title) return;
    // Local only: scheduling a save here would mark the page dirty and
    // unmount the failed-save recovery button on the blur that precedes
    // the click.
    draftRef.current = { ...current, title };
    setDraft(draftRef.current);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (saved.current < changed.current) void drain();
    },
    [drain],
  );

  const hasUnsaved =
    saveState !== "saved" || saved.current < changed.current || uploadBusy;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => {
      const currentPage = (current.search as { page?: string }).page;
      const nextPage = (next.search as { page?: string }).page;
      return hasUnsaved && (current.pathname !== next.pathname || currentPage !== nextPage);
    },
    enableBeforeUnload: () => hasUnsaved,
    withResolver: true,
  });

  // The server already searched titles and body text, so only the property
  // filters are applied here. Filtering flattens the tree: a match whose parent
  // was filtered out still has to be reachable.
  const searching =
    Boolean(search.q) ||
    hasFilters({ ...search, q: undefined, tree: undefined });
  const [localPages, setLocalPages] = useState<ContentPage[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const indexPages = useMemo(() => {
    const source = localPages ?? list.data ?? [];
    if (!draft || draft.id !== selectedId) return source;
    return source.map((page) =>
      page.id === draft.id
        ? { ...page, typeIds: draft.typeIds, subpageTypeId: draft.subpageTypeId }
        : page,
    );
  }, [localPages, list.data, draft, selectedId]);
  // Reorder commits run one at a time, in drag order: two quick drags would
  // otherwise race and the earlier drag's order could land last in SQLite.
  const orderChain = useRef<Promise<void>>(Promise.resolve());
  const visiblePages = useMemo(
    () => filterPageSearchResults(indexPages, hierarchy.data ?? [], search),
    [hierarchy.data, indexPages, search],
  );
  const treeRootId = search.tree ?? null;
  const rows = useMemo(
    () => pageRows(visiblePages, searching, treeRootId),
    [visiblePages, searching, treeRootId],
  );
  // Dragging a searched or property-filtered list would persist an order the
  // user never saw whole, so those stay read-only. Filtering to one page's
  // tree keeps every sibling group below it complete, so that view sorts like
  // the full index; the index is sortable once some group on screen actually
  // has more than one page.
  const tree = useMemo(
    () => pageTree(visiblePages, treeRootId),
    [visiblePages, treeRootId],
  );
  const canReorder = !list.isPending && canSortIndex(tree, searching);
  const draggedPage = draggedId
    ? indexPages.find((page) => page.id === draggedId)
    : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commitOrder = async (id: string, orderedIds: string[]) => {
    // Total: never rejects, so the serialized chain behind it cannot stall.
    // Each banner says exactly what happened, so a failed refresh never hides
    // behind a claimed one.
    let saved = false;
    let fresh = false;
    try {
      saved = (await movePage({ data: { id, orderedIds } })).ok;
    } catch {
      saved = false;
    }
    try {
      await invalidateContent(queryClient);
      fresh = true;
    } catch {
      fresh = false;
    }
    if (saved && fresh) setActionError("");
    else if (!saved && fresh)
      setActionError("That page could not be moved. The list has been refreshed.");
    else if (saved && !fresh)
      setActionError(
        "The new order was saved, but the list could not be refreshed. Reload the page if it looks stale.",
      );
    else
      setActionError(
        "That page could not be moved, and the list could not be refreshed. Reload the page.",
      );
    setLocalPages(null);
  };

  const onIndexDragStart = (event: DragStartEvent) => {
    setDraggedId(String(event.active.id));
  };

  const onIndexDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);
    setDraggedId(null);
    if (!over || activeId === String(over.id)) return;
    const overId = String(over.id);
    const source = localPages ?? list.data ?? [];
    const activePage = source.find((page) => page.id === activeId);
    if (!activePage) return;
    // `over` is always a sibling with the same pin state (see
    // sameLevelCollision), and a drop cannot cross the pin line. Under a tree
    // filter the group comes from the filtered tree, which still holds every
    // sibling below the filtered page, so the saved order is complete.
    const move = reorderedSiblings(tree, activePage, overId);
    if (!move) return;
    const { orderedIds, orderOf } = move;
    setLocalPages(source.map((page) => (orderOf.has(page.id) ? { ...page, order: orderOf.get(page.id)! } : page)));
    setActionError("");
    orderChain.current = orderChain.current.then(() => commitOrder(activeId, orderedIds));
  };

  const updateSearch = (patch: ToolbarPatch) =>
    void navigate({
      to: "/content",
      search: { ...search, ...patch },
      replace: true,
    });

  const filterToTree = (tree: string) =>
    void navigate({
      to: "/content",
      search: { ...search, tree },
      replace: true,
    });

  const setPinned = async (id: string, pinned: boolean) => {
    const failed = pinned
      ? "The page could not be pinned."
      : "The page could not be unpinned.";
    try {
      const result = await setPagePinned({ data: { id, pinned } });
      if (!result.ok) {
        setActionError(failed);
        return;
      }
      setActionError("");
      setLocalPages(null);
      if (draftRef.current?.id === id) {
        const next = { ...draftRef.current, pinned };
        draftRef.current = next;
        setDraft(next);
      }
      await invalidateContent(queryClient);
    } catch {
      setActionError(failed);
    }
  };

  // Deleting from the index moves the page to trash, where it can be
  // restored. The server moves the whole subtree, so the confirmation names
  // the subpages going with it and the open editor returns to the list when
  // it was inside that subtree.
  // The rows on screen can be filtered by search or tree, hiding the very
  // subpages a delete would take with it. The unfiltered list loads while
  // the confirmation is open so the count and the editor redirect see the
  // whole subtree; until it lands the dialog uses copy that never undercounts.
  useEffect(() => {
    if (!deletingPage) {
      setDeleteScope(null);
      return;
    }
    let cancelled = false;
    void queryClient
      .fetchQuery(pagesQuery())
      .then((pages) => {
        if (!cancelled) setDeleteScope(pages);
      })
      .catch(() => {
        if (!cancelled) setDeleteScope(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deletingPage, queryClient]);

  const confirmIndexDelete = async () => {
    const target = deletingPage;
    if (!target || recoveringRef.current || deleteBusy) return;
    if (!(await drain())) return;
    setDeleteBusy(true);
    try {
      const freshRevision =
        draftRef.current?.id === target.id ? draftRef.current.revision : target.revision;
      const result = await trashPage({ data: { id: target.id, revision: freshRevision } });
      if (!result.ok) {
        setActionError(
          "This page changed before it could be deleted. The list has been refreshed.",
        );
        setDeletingPage(null);
        await invalidateContent(queryClient);
        return;
      }
      setActionError("");
      setLocalPages(null);
      setDeletingPage(null);
      await invalidateContent(queryClient, contentKeys.all);
      if (selectedId) {
        let scope = deleteScope;
        if (!scope) {
          try {
            scope = await queryClient.fetchQuery(pagesQuery());
          } catch {
            scope = null;
          }
        }
        const known = new Map(
          (scope ?? [...indexPages, ...(hierarchy.data ?? [])]).map((page) => [
            page.id,
            page,
          ]),
        );
        if (draftRef.current && !known.has(draftRef.current.id))
          known.set(draftRef.current.id, draftRef.current);
        if (isInSubtree([...known.values()], selectedId, target.id)) {
          loadedId.current = null;
          await navigate({
            to: "/content",
            search: { ...search, page: undefined },
          });
        }
      }
    } catch (error) {
      setActionError(readableError(error, "The page could not be deleted."));
    } finally {
      setDeleteBusy(false);
    }
  };

  const deleteChildCount =
    deletingPage && deleteScope ? countDescendants(deleteScope, deletingPage.id) : null;

  const applyProperties = async (patch: PropertyPatch) => {
    const current = draftRef.current;
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      typeIds: patch.typeIds ?? current.typeIds,
      tagIds: patch.tagIds ?? current.tagIds,
      subpageTypeId:
        patch.subpageTypeId !== undefined ? patch.subpageTypeId : current.subpageTypeId,
    };
    draftRef.current = next;
    setDraft(next);
    // Only the properties this request set, and only while they are still the
    // ones on screen. The whole draft cannot be restored: the editor may have
    // typed since, and putting that text back would hand the pending autosave
    // an older document to persist.
    const rollback = () => {
      const latest = draftRef.current;
      if (!latest || latest.id !== current.id) return;
      const restored = { ...latest };
      if (patch.statusId !== undefined && latest.statusId === next.statusId)
        restored.statusId = current.statusId;
      if (patch.typeIds !== undefined && latest.typeIds.join() === next.typeIds.join())
        restored.typeIds = current.typeIds;
      if (patch.tagIds !== undefined && latest.tagIds.join() === next.tagIds.join())
        restored.tagIds = current.tagIds;
      if (
        patch.subpageTypeId !== undefined &&
        latest.subpageTypeId === next.subpageTypeId
      )
        restored.subpageTypeId = current.subpageTypeId;
      draftRef.current = restored;
      setDraft(restored);
      setActionError("The page properties could not be saved.");
    };
    try {
      const result = await setPageProperties({ data: { id: current.id, ...patch } });
      if (!result.ok) {
        rollback();
        return;
      }
      setActionError("");
      const editing = draftRef.current?.id === current.id ? draftRef.current : null;
      queryClient.setQueryData(contentKeys.detail(current.id), {
        ...result.page,
        document: editing?.document ?? current.document,
      });
      await invalidateContent(queryClient);
    } catch {
      rollback();
    }
  };

  const addTag = async (name: string): Promise<string[] | null> => {
    const names = splitTagNames(name);
    if (!names.length) return null;
    try {
      const ids: string[] = [];
      for (const entry of names) {
        const created = (await createContentProperty({
          data: { kind: "tag", name: entry },
        })) as { ok?: boolean; id?: string; ids?: string[] };
        if (created.ok === false) {
          setActionError("The tag could not be created.");
          return null;
        }
        const all = created.ids ?? (created.id ? [created.id] : []);
        for (const id of all) if (!ids.includes(id)) ids.push(id);
      }
      await invalidateContent(queryClient, contentKeys.properties);
      return ids.length ? ids : null;
    } catch {
      setActionError("The tag could not be created.");
      return null;
    }
  };
  const selectPage = async (page: string | undefined) => {
    if (recoveringRef.current || page === selectedId) return;
    if (!(await drain())) return;
    loadedId.current = null;
    await navigate({ to: "/content", search: { ...search, page } });
  };

  const addPage = async (parentId: string | null) => {
    if (recoveringRef.current) return;
    if (!(await drain())) return;
    try {
      const created = await createPage({ data: { title: "", parentId } });
      queryClient.setQueryData(contentKeys.detail(created.id), created);
      await invalidateContent(queryClient);
      // A move in flight shadows the list with its optimistic order; drop the
      // overlay so the created page is not hidden until that move lands.
      setLocalPages(null);
      loadedId.current = null;
      setActionError("");
      await navigate({
        to: "/content",
        search: { ...search, q: undefined, page: created.id },
      });
    } catch (error) {
      setActionError(readableError(error, "The page could not be created."));
    }
  };

  // The top bar's New page runs this flow so pending edits are saved and the
  // list overlay is cleared before the created page opens.
  const addPageRef = useRef(addPage);
  addPageRef.current = addPage;
  const setPageCreator = useUI((state) => state.setPageCreator);
  const theme = useUI((state) => state.theme);
  useEffect(() => {
    setPageCreator(() => addPageRef.current(null));
    return () => setPageCreator(null);
  }, [setPageCreator]);

  // The editor is lazy and client-only. Start the embed fetches while that
  // chunk loads so a first visit can paint the cards instead of skeletons.
  useEffect(() => {
    if (!draft) return;
    for (const id of tweetIdsFromDocument(draft.document)) {
      void queryClient.prefetchQuery(tweetEmbedQuery(id, theme));
    }
    for (const url of bookmarkUrlsFromDocument(draft.document)) {
      void queryClient.prefetchQuery(linkPreviewQuery(url));
    }
  }, [draft, queryClient, theme]);

  const saveAsNewPage = async (openCopy = true) => {
    if (recoveringRef.current) return false;
    await uploads.idle();
    const snapshot = draftRef.current;
    if (!snapshot) return false;
    recoveringRef.current = true;
    setRecovering(true);
    setSaveState("saving");
    try {
      const recovered = await createPage({
        data: {
          title: persistedPageTitle(snapshot.title),
          parentId: null,
          document: snapshot.document,
        },
      });
      loadedId.current = recovered.id;
      draftRef.current = recovered;
      setDraft(recovered);
      saved.current = changed.current;
      staleRevision.current = null;
      setSaveConflict(false);
      setSaveUnavailable(false);
      setSaveError("");
      setSaveState("saved");
      queryClient.setQueryData(contentKeys.detail(recovered.id), recovered);
      await invalidateContent(queryClient);
      setLocalPages(null);
      if (openCopy)
        await navigate({
          to: "/content",
          search: { ...search, page: recovered.id },
        });
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveError(
        readableError(
          error,
          "The replacement page could not be saved. Your text is still here.",
        ),
      );
      return false;
    } finally {
      recoveringRef.current = false;
      setRecovering(false);
    }
  };

  return (
    <section aria-label="Pages">
      {actionError && (
        <p
          className="mb-5 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}
      <div>
        <ContentToolbar
          properties={properties}
          search={search}
          onChange={updateSearch}
        />
      </div>
      <div className="content-workspace mt-4">
        <aside className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-136 flex-col border-r bg-card`} aria-label="Content pages">
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 lg:sticky lg:top-12 lg:max-h-[calc(100dvh-3rem)] lg:flex-none">
            {list.isPending || (search.tree && hierarchy.isPending) ? (
              <p className="p-3 text-muted-foreground">Loading pages…</p>
            ) : search.tree && hierarchy.isError ? (
              <div className="p-4 text-center">
                <p className="text-sm text-destructive" role="alert">
                  The page tree could not load.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => void hierarchy.refetch()}
                >
                  Reload pages
                </Button>
              </div>
            ) : rows.length ? (
              canReorder ? (
                <ClientOnly
                  fallback={
                    <PageIndexList
                      rows={rows}
                      properties={properties}
                      selectedId={selectedId}
                      disabled={recovering}
                      onSelect={(id) => void selectPage(id)}
                      onCreateSubpage={(id) => void addPage(id)}
                      onFilterTree={filterToTree}
                      onSetPinned={setPinned}
                      onDelete={(page) => setDeletingPage(page)}
                    />
                  }
                >
                  <DndContext
                    sensors={sensors}
                    collisionDetection={sameLevelCollision}
                    onDragStart={onIndexDragStart}
                    onDragEnd={onIndexDragEnd}
                    onDragCancel={() => setDraggedId(null)}
                  >
                    <SortableGroup
                      parentId={null}
                      depth={0}
                      tree={tree}
                      properties={properties}
                      selectedId={selectedId}
                      disabled={recovering}
                      onSelect={(id) => void selectPage(id)}
                      onCreateSubpage={(id) => void addPage(id)}
                      onFilterTree={filterToTree}
                      onSetPinned={setPinned}
                      onDelete={(page) => setDeletingPage(page)}
                    />
                    {tree.orphans.map((page) => (
                      <PageIndexRow
                        key={page.id}
                        page={page}
                        properties={properties}
                        depth={0}
                        selected={selectedId === page.id}
                        disabled={recovering}
                        onSelect={(id) => void selectPage(id)}
                        onCreateSubpage={(id) => void addPage(id)}
                        onFilterTree={filterToTree}
                        onSetPinned={setPinned}
                        onDelete={(page) => setDeletingPage(page)}
                      />
                    ))}
                    <DragOverlay>
                      {draggedPage ? (
                        <div className="flex min-h-10 w-full items-center gap-2 rounded-lg bg-accent px-2 text-sm font-medium shadow-lg">
                          <PageIcon page={draggedPage} properties={properties} />
                          <span className="truncate">
                            {displayPageTitle(draggedPage.title)}
                          </span>
                          {draggedPage.pinned ? (
                            <Pin className="ml-auto size-3.5 shrink-0" aria-hidden />
                          ) : null}
                        </div>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </ClientOnly>
              ) : (
                <PageIndexList
                  rows={rows}
                  properties={properties}
                  selectedId={selectedId}
                  disabled={recovering}
                  onSelect={(id) => void selectPage(id)}
                  onCreateSubpage={(id) => void addPage(id)}
                  onFilterTree={filterToTree}
                  onSetPinned={setPinned}
                  onDelete={(page) => setDeletingPage(page)}
                />
              )
            ) : (
              <p className="p-4 text-center text-muted-foreground">{search.q ? "No pages match your search." : "No pages yet."}</p>
            )}
          </div>
        </aside>
        <div className={`${selectedId ? "block" : "hidden lg:block"} min-w-0 bg-card`}>
          {!selectedId ? (
            <div className="flex min-h-136 items-center justify-center p-6 text-center text-muted-foreground">
              <div><FileText className="mx-auto mb-3 size-8" /><p>Choose a page or create one.</p></div>
            </div>
          ) : detail.isError ? (
            <div className="flex min-h-136 items-center justify-center p-6 text-center"><div><p role="alert">The page could not load.</p><Button className="mt-3" variant="outline" onClick={() => void detail.refetch()}>Reload page</Button></div></div>
          ) : !detail.isPending &&
            detail.data === null &&
            (draft?.id !== selectedId || !hasUnsaved) ? (
            <div className="flex min-h-136 items-center justify-center p-6 text-center">
              <div><p>This page is no longer available.</p><Button className="mt-3" variant="outline" onClick={() => void selectPage(undefined)}>Back to page list</Button></div>
            </div>
          ) : detail.isPending || !draft ? (
            <div className="min-h-136 animate-pulse bg-muted" aria-label="Loading page" />
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
                <Button variant="ghost" size="icon" className="lg:hidden" disabled={recovering} aria-label="Back to page list" onClick={() => void selectPage(undefined)}><ArrowLeft /></Button>
                <span className="flex-1" />
                <span className={`text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`} role="status" aria-live="polite">
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Unsaved"}
                </span>
                {saveState === "error" && (
                  <Button variant="outline" size="sm" disabled={recovering} onClick={() => {
                    if (saveUnavailable) {
                      void saveAsNewPage();
                      return;
                    }
                    if (saveConflict && staleRevision.current !== null && draftRef.current) {
                      draftRef.current = { ...draftRef.current, revision: staleRevision.current };
                      setDraft(draftRef.current);
                      staleRevision.current = null;
                    }
                    void drain();
                  }}>{recovering ? "Saving copy…" : saveUnavailable ? "Save as new page" : saveConflict ? "Overwrite saved version" : "Try saving again"}</Button>
                )}
                <Button variant="outline" size="sm" disabled={recovering} onClick={() => void addPage(draft.id)} aria-label={`New subpage under ${displayPageTitle(draft.title)}`}><FilePlus2 /> Subpage</Button>
                <Button variant="destructive" size="icon-sm" disabled={recovering} aria-label={`Move ${displayPageTitle(draft.title)} to trash`} onClick={async () => {
                  if (!(await drain())) return;
                  const current = draftRef.current!;
                  const sourceId = current.id;
                  const sourceSequence = changed.current;
                  try {
                    const result = await trashPage({ data: { id: current.id, revision: current.revision } });
                    const sameSource =
                      selectedId === sourceId && draftRef.current?.id === sourceId;
                    const sourceChanged = changed.current !== sourceSequence;
                    if (!result.ok) {
                      if (result.current) {
                        queryClient.setQueryData(
                          contentKeys.detail(sourceId),
                          result.current,
                        );
                        if (
                          sameSource &&
                          !sourceChanged &&
                          applyFreshDetail(result.current)
                        ) {
                          setActionError(
                            "This page changed in another tab. Review it, then try moving it to trash again.",
                          );
                        } else if (sameSource && sourceChanged) {
                          staleRevision.current = result.current.revision;
                          setSaveConflict(true);
                          setSaveUnavailable(false);
                          setSaveState("error");
                          setSaveError(
                            "This page changed in another tab. Your unsaved text is still here.",
                          );
                        }
                      } else {
                        queryClient.setQueryData(contentKeys.detail(sourceId), null);
                        if (sameSource && sourceChanged) {
                          staleRevision.current = null;
                          setSaveConflict(false);
                          setSaveUnavailable(true);
                          setSaveState("error");
                          setSaveError(
                            "This page is no longer available. Your unsaved text is still here.",
                          );
                        } else if (sameSource) {
                          setActionError("This page is no longer available.");
                        }
                      }
                      await invalidateContent(queryClient);
                      return;
                    }
                    await invalidateContent(queryClient, contentKeys.all);
                    // A move in flight shadows the list with its optimistic order;
                    // drop the overlay so the trashed page leaves the index now.
                    setLocalPages(null);
                    if (sameSource && sourceChanged) {
                      staleRevision.current = null;
                      setSaveConflict(false);
                      setSaveUnavailable(true);
                      setSaveState("error");
                      setSaveError(
                        "This page is in the trash. Your unsaved text is still here.",
                      );
                      return;
                    }
                    if (!sameSource) return;
                    loadedId.current = null;
                    setActionError("");
                    await navigate({
                      to: "/content",
                      search: { ...search, page: undefined },
                    });
                  } catch (error) {
                    setActionError(readableError(error, "The page could not be moved to trash."));
                  }
                }}><Trash2 /></Button>
              </div>
              <div className="content-page-body">
                <div className="flex items-start gap-3">
                  <PageIcon
                    page={draft}
                    properties={properties}
                    size="title"
                    className="mt-0.5"
                  />
                  <input
                    aria-label="Page title"
                    value={draft.title}
                    disabled={recovering}
                    placeholder={DEFAULT_PAGE_TITLE}
                    className="min-w-0 flex-1 border-none bg-transparent p-0 text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40 sm:text-[2rem]"
                    onChange={(event) => scheduleSave({ ...draftRef.current!, title: event.target.value })}
                    onBlur={commitPageTitle}
                  />
                </div>
                <PropertyPanel
                  page={draft}
                  properties={properties}
                  disabled={recovering || propertyQuery.isPending}
                  onChange={(patch) => void applyProperties(patch)}
                  onCreateTag={addTag}
                />
              </div>
              {saveError && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">{saveError}</div>}
              <ClientOnly fallback={<div className="min-h-120 animate-pulse bg-muted" aria-label="Loading editor" />}>
                <Suspense fallback={<div className="min-h-120 animate-pulse bg-muted" aria-label="Loading editor" />}>
                  <ContentEditor
                    key={`${draft.id}:${editorGeneration}`}
                    page={draft}
                    editable={!recovering}
                    onUploadStart={onUploadStart}
                    onUploadEnd={onUploadEnd}
                    onDocumentChange={(document: ContentBlock[]) => {
                      const current = draftRef.current;
                      if (
                        recoveringRef.current ||
                        !current ||
                        current.id !== draft.id
                      )
                        return;
                      scheduleSave({ ...current, document });
                    }}
                  />
                </Suspense>
              </ClientOnly>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={deletingPage !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeletingPage(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deletingPage
                ? `Move "${displayPageTitle(deletingPage.title)}" to trash?`
                : "Move this page to trash?"}
            </DialogTitle>
            <DialogDescription>
              {deleteChildCount === null
                ? "This page and its subpages will be moved to trash. You can restore them from Trash."
                : deleteChildCount > 0
                  ? `This page and its ${deleteChildCount} subpage${deleteChildCount === 1 ? "" : "s"} will be moved to trash. You can restore them from Trash.`
                  : "This page will be moved to trash. You can restore it from Trash."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDeletingPage(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void confirmIndexDelete()}
            >
              {deleteBusy ? "Moving…" : "Move to trash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={blocker.status === "blocked"} onOpenChange={(open) => { if (!open && blocker.status === "blocked") blocker.reset(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Save this page before leaving?</DialogTitle>
            <DialogDescription>Your latest changes are still in this editor.</DialogDescription>
          </DialogHeader>
            {saveError && <p className="mt-2 text-sm text-destructive" role="alert">{saveError}</p>}
          <DialogFooter>
              <Button variant="outline" onClick={() => { if (blocker.status === "blocked") blocker.reset(); }}>Stay here</Button>
              <Button disabled={recovering} onClick={async () => {
                if (saveUnavailable) {
                  if ((await saveAsNewPage(false)) && blocker.status === "blocked") blocker.proceed();
                  return;
                }
                if (saveConflict && staleRevision.current !== null && draftRef.current) {
                  draftRef.current = { ...draftRef.current, revision: staleRevision.current };
                  setDraft(draftRef.current);
                  staleRevision.current = null;
                }
                if ((await drain()) && blocker.status === "blocked") blocker.proceed();
              }}>{recovering ? "Saving copy…" : saveUnavailable ? "Save copy and continue" : saveConflict ? "Overwrite and continue" : "Save and continue"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PageIndexButton({
  page,
  properties,
  depth,
  selected,
  disabled,
  onSelect,
}: {
  page: ContentPage;
  properties: ContentProperties;
  depth: number;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-10 w-full items-center gap-2 rounded-lg pr-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-medium"
      style={{ paddingLeft: `${Math.min(depth, 8) * 16 + 8}px` }}
      aria-current={selected ? "page" : undefined}
      disabled={disabled}
      onClick={() => onSelect(page.id)}
    >
      <PageIcon page={page} properties={properties} />
      <span className="truncate">{displayPageTitle(page.title)}</span>
      {page.pinned ? (
        <>
          <span className="sr-only">Pinned</span>
          <Pin className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </>
      ) : null}
    </button>
  );
}

/**
 * Trigger sits outside the drag handle so a touchstart `stopPropagation` on
 * the menu cannot swallow the pointer events dnd-kit needs to reorder.
 */
function PageContextMenu({
  page,
  disabled,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
  children,
}: {
  page: ContentPage;
  disabled: boolean;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger className="block w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={disabled}
          onClick={() => onSetPinned(page.id, !page.pinned)}
        >
          {page.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {page.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        {page.parentId === null && (
          <ContextMenuItem disabled={disabled} onClick={() => onFilterTree(page.id)}>
            <ListFilter className="size-4" /> Filter to this page
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={disabled}
          onClick={() => onCreateSubpage(page.id)}
        >
          <FilePlus2 className="size-4" /> New subpage
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled} onClick={() => onDelete(page)}>
          <Trash2 className="size-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PageIndexRow({
  page,
  properties,
  depth,
  selected,
  disabled,
  onSelect,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
}: {
  page: ContentPage;
  properties: ContentProperties;
  depth: number;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
}) {
  return (
    <PageContextMenu
      page={page}
      disabled={disabled}
      onCreateSubpage={onCreateSubpage}
      onFilterTree={onFilterTree}
      onSetPinned={onSetPinned}
      onDelete={onDelete}
    >
      <PageIndexButton
        page={page}
        properties={properties}
        depth={depth}
        selected={selected}
        disabled={disabled}
        onSelect={onSelect}
      />
    </PageContextMenu>
  );
}

function PageIndexList({
  rows,
  properties,
  selectedId,
  disabled,
  onSelect,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
}: {
  rows: { page: ContentPage; depth: number }[];
  properties: ContentProperties;
  selectedId: string | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
}) {
  return (
    <>
      {rows.map(({ page, depth }) => (
        <PageIndexRow
          key={page.id}
          page={page}
          properties={properties}
          depth={depth}
          selected={selectedId === page.id}
          disabled={disabled}
          onSelect={onSelect}
          onCreateSubpage={onCreateSubpage}
          onFilterTree={onFilterTree}
          onSetPinned={onSetPinned}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

/**
 * One sibling group as its own sortable list. Pinned and unpinned pages are
 * separate lists so a drag cannot cross the pin line. Each row's sortable
 * node wraps its subtree, so the group's items are contiguous, a subtree
 * moves as one piece, and the preview shows exactly the sibling order that
 * gets saved.
 */
function SortableGroup({
  parentId,
  depth,
  tree,
  properties,
  selectedId,
  disabled,
  onSelect,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
}: {
  parentId: string | null;
  depth: number;
  tree: PageTree;
  properties: ContentProperties;
  selectedId: string | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
}) {
  const pages = tree.children.get(parentId) ?? [];
  if (!pages.length) return null;
  const pinned = pages.filter((page) => page.pinned);
  const unpinned = pages.filter((page) => !page.pinned);
  return (
    <>
      <SortableSiblingList
        pages={pinned}
        depth={depth}
        tree={tree}
        properties={properties}
        selectedId={selectedId}
        disabled={disabled}
        onSelect={onSelect}
        onCreateSubpage={onCreateSubpage}
        onFilterTree={onFilterTree}
        onSetPinned={onSetPinned}
        onDelete={onDelete}
      />
      <SortableSiblingList
        pages={unpinned}
        depth={depth}
        tree={tree}
        properties={properties}
        selectedId={selectedId}
        disabled={disabled}
        onSelect={onSelect}
        onCreateSubpage={onCreateSubpage}
        onFilterTree={onFilterTree}
        onSetPinned={onSetPinned}
        onDelete={onDelete}
      />
    </>
  );
}

function SortableSiblingList({
  pages,
  depth,
  tree,
  properties,
  selectedId,
  disabled,
  onSelect,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
}: {
  pages: ContentPage[];
  depth: number;
  tree: PageTree;
  properties: ContentProperties;
  selectedId: string | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
}) {
  if (!pages.length) return null;
  return (
    <SortableContext items={pages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
      {pages.map((page) => (
        <SortablePageRow
          key={page.id}
          page={page}
          properties={properties}
          depth={depth}
          selected={selectedId === page.id}
          disabled={disabled}
          sortable={pages.length > 1}
          onSelect={onSelect}
          onCreateSubpage={onCreateSubpage}
          onFilterTree={onFilterTree}
          onSetPinned={onSetPinned}
          onDelete={onDelete}
        >
          <SortableGroup
            parentId={page.id}
            depth={depth + 1}
            tree={tree}
            properties={properties}
            selectedId={selectedId}
            disabled={disabled}
            onSelect={onSelect}
            onCreateSubpage={onCreateSubpage}
            onFilterTree={onFilterTree}
            onSetPinned={onSetPinned}
            onDelete={onDelete}
          />
        </SortablePageRow>
      ))}
    </SortableContext>
  );
}

function SortablePageRow({
  page,
  properties,
  depth,
  selected,
  disabled,
  sortable,
  onSelect,
  onCreateSubpage,
  onFilterTree,
  onSetPinned,
  onDelete,
  children,
}: {
  page: ContentPage;
  properties: ContentProperties;
  depth: number;
  selected: boolean;
  disabled: boolean;
  /** False when the page has no sibling to swap with: the row stays a button. */
  sortable: boolean;
  onSelect: (id: string) => void;
  onCreateSubpage: (id: string) => void;
  onFilterTree: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onDelete: (page: ContentPage) => void;
  /** The page's own subtree, carried along when the row moves. */
  children?: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: page.id,
    data: { parentId: page.parentId, pinned: page.pinned },
    disabled: disabled || !sortable,
  });
  // Only the row itself is the handle; the subtree below it is outside the
  // handle, so grabbing a child never drags the parent. The context-menu
  // trigger wraps the handle so a right-click still opens the page menu.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-40" : ""}
    >
      <PageContextMenu
        page={page}
        disabled={disabled}
        onCreateSubpage={onCreateSubpage}
        onFilterTree={onFilterTree}
        onSetPinned={onSetPinned}
        onDelete={onDelete}
      >
        <div ref={setActivatorNodeRef} {...attributes} {...listeners}>
          <PageIndexButton
            page={page}
            properties={properties}
            depth={depth}
            selected={selected}
            disabled={disabled}
            onSelect={onSelect}
          />
        </div>
      </PageContextMenu>
      {children}
    </div>
  );
}

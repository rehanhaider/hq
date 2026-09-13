import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClientOnly, useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, FilePlus2, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  filterPages,
  hasFilters,
  type ContentBlock,
  type ContentPage,
  type ContentProperties,
  type PageDetail,
} from "@/lib/content";
import {
  contentKeys,
  contentPropertiesQuery,
  pageQuery,
  pagesQuery,
} from "@/queries/content";
import {
  createContentProperty,
  createPage,
  savePage,
  setPageProperties,
  trashPage,
} from "@/server/fns";
import { ContentToolbar, type ToolbarPatch } from "./ContentToolbar";
import { SearchBox } from "./SearchBox";
import { PropertyPanel, type PropertyPatch } from "./PropertyPanel";

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

function pageRows(pages: ContentPage[], searching: boolean) {
  if (searching) return pages.map((page) => ({ page, depth: 0 }));
  const children = new Map<string | null, ContentPage[]>();
  for (const page of pages) {
    const siblings = children.get(page.parentId) ?? [];
    siblings.push(page);
    children.set(page.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const rows: { page: ContentPage; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      rows.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const page of pages) if (!seen.has(page.id)) rows.push({ page, depth: 0 });
  return rows;
}

export function ContentWorkspace() {
  const search = useSearch({ from: "/content" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery(pagesQuery(search.q));
  const propertyQuery = useQuery(contentPropertiesQuery);
  const properties: ContentProperties = propertyQuery.data ?? {
    statuses: [],
    types: [],
    tags: [],
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
  const staleRevision = useRef<number | null>(null);
  const recoveringRef = useRef(false);

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
      while (saved.current < changed.current) {
        const sequence = changed.current;
        const snapshot = draftRef.current;
        if (!snapshot) return true;
        setSaveState("saving");
        setSaveError("");
        try {
          const result = await savePage({
            data: {
              id: snapshot.id,
              title: snapshot.title.trim() || "Untitled",
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
            draftRef.current = {
              ...draftRef.current,
              title: sequence === changed.current ? result.page.title : draftRef.current.title,
              revision: result.page.revision,
              updatedAt: result.page.updatedAt,
            };
            setDraft((current) =>
              current?.id === snapshot.id
                ? {
                    ...current,
                    title: sequence === changed.current ? result.page.title : current.title,
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
          void queryClient.invalidateQueries({ queryKey: contentKeys.lists });
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
      setSaveState("saved");
      return true;
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (saved.current < changed.current) void drain();
    },
    [drain],
  );

  const hasUnsaved = saveState !== "saved" || saved.current < changed.current;
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
  const rows = useMemo(() => {
    const pages = filterPages(list.data ?? [], {
      status: search.status,
      type: search.type,
      tag: search.tag,
    });
    return pageRows(pages, Boolean(search.q) || hasFilters({ ...search, q: undefined }));
  }, [list.data, search]);

  const updateSearch = (patch: ToolbarPatch) =>
    void navigate({
      to: "/content",
      search: { ...search, ...patch },
      replace: true,
    });

  const applyProperties = async (patch: PropertyPatch) => {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...current, ...patch, tagIds: patch.tagIds ?? current.tagIds };
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
      if (patch.typeId !== undefined && latest.typeId === next.typeId)
        restored.typeId = current.typeId;
      if (patch.tagIds !== undefined && latest.tagIds.join() === next.tagIds.join())
        restored.tagIds = current.tagIds;
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
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists });
    } catch {
      rollback();
    }
  };

  const addTag = async (name: string) => {
    try {
      const created = await createContentProperty({ data: { kind: "tag", name } });
      await queryClient.invalidateQueries({ queryKey: contentKeys.properties });
      return created.id;
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
      const created = await createPage({ data: { title: "Untitled", parentId } });
      queryClient.setQueryData(contentKeys.detail(created.id), created);
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists });
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

  const saveAsNewPage = async (openCopy = true) => {
    if (recoveringRef.current) return false;
    const snapshot = draftRef.current;
    if (!snapshot) return false;
    recoveringRef.current = true;
    setRecovering(true);
    setSaveState("saving");
    try {
      const recovered = await createPage({
        data: {
          title: snapshot.title.trim() || "Untitled",
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
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists });
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
    <section aria-labelledby="content-heading">
      <header className="page-header">
        <div>
          <h1 id="content-heading" className="page-title">Pages</h1>
          <p className="page-description">
            Every page is a piece of content: write it here, track it on the board.
          </p>
        </div>
        <Button disabled={recovering} onClick={() => void addPage(null)}><FilePlus2 /> New page</Button>
      </header>
      {actionError && (
        <p
          className="mt-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}
      <div className="mt-5">
        <ContentToolbar
          properties={properties}
          search={search}
          onChange={updateSearch}
        />
      </div>
      <div className="content-workspace mt-4">
        <aside className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-[34rem] flex-col border-r bg-card`} aria-label="Content pages">
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {list.isPending ? (
              <p className="p-3 text-muted-foreground">Loading pages…</p>
            ) : rows.length ? (
              rows.map(({ page, depth }) => (
                <button
                  key={page.id}
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg pr-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                  style={{ paddingLeft: `${Math.min(depth, 8) * 16 + 8}px` }}
                  aria-current={selectedId === page.id ? "page" : undefined}
                  disabled={recovering}
                  onClick={() => void selectPage(page.id)}
                >
                  {depth > 0 ? <ChevronRight className="size-3 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{page.title}</span>
                </button>
              ))
            ) : (
              <p className="p-4 text-center text-muted-foreground">{search.q ? "No pages match your search." : "No pages yet."}</p>
            )}
          </div>
        </aside>
        <div className={`${selectedId ? "block" : "hidden lg:block"} min-w-0 bg-card`}>
          {!selectedId ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center text-muted-foreground">
              <div><FileText className="mx-auto mb-3 size-8" /><p>Choose a page or create one.</p></div>
            </div>
          ) : detail.isError ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center"><div><p role="alert">The page could not load.</p><Button className="mt-3" variant="outline" onClick={() => void detail.refetch()}>Reload page</Button></div></div>
          ) : !detail.isPending &&
            detail.data === null &&
            (draft?.id !== selectedId || !hasUnsaved) ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center">
              <div><p>This page is no longer available.</p><Button className="mt-3" variant="outline" onClick={() => void selectPage(undefined)}>Back to page list</Button></div>
            </div>
          ) : detail.isPending || !draft ? (
            <div className="min-h-[34rem] animate-pulse bg-muted" aria-label="Loading page" />
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
                <Button variant="outline" size="sm" disabled={recovering} onClick={() => void addPage(draft.id)} aria-label={`New subpage under ${draft.title}`}><FilePlus2 /> Subpage</Button>
                <Button variant="destructive" size="icon-sm" disabled={recovering} aria-label={`Move ${draft.title} to trash`} onClick={async () => {
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
                      await queryClient.invalidateQueries({
                        queryKey: contentKeys.lists,
                      });
                      return;
                    }
                    await queryClient.invalidateQueries({ queryKey: contentKeys.all });
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
                <input
                  aria-label="Page title"
                  value={draft.title}
                  disabled={recovering}
                  placeholder="Untitled"
                  className="w-full border-none bg-transparent p-0 text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40 sm:text-[2rem]"
                  onChange={(event) => scheduleSave({ ...draftRef.current!, title: event.target.value })}
                  onBlur={() => {
                    if (!draftRef.current?.title.trim()) scheduleSave({ ...draftRef.current!, title: "Untitled" });
                  }}
                />
                <PropertyPanel
                  page={draft}
                  properties={properties}
                  disabled={recovering || propertyQuery.isPending}
                  onChange={(patch) => void applyProperties(patch)}
                  onCreateTag={addTag}
                />
              </div>
              {saveError && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">{saveError}</div>}
              <ClientOnly fallback={<div className="min-h-[30rem] animate-pulse bg-muted" aria-label="Loading editor" />}>
                <Suspense fallback={<div className="min-h-[30rem] animate-pulse bg-muted" aria-label="Loading editor" />}>
                  <ContentEditor
                    key={`${draft.id}:${editorGeneration}`}
                    page={draft}
                    editable={!recovering}
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

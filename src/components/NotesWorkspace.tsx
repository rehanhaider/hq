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
import {
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { NoteBlock, NoteDetail, NotePage } from "@/lib/notes";
import { noteKeys, noteQuery, notesQuery } from "@/queries/notes";
import { createNote, restoreNote, saveNote, trashNote } from "@/server/fns";

const NotesEditor = lazy(() =>
  import("./NotesEditor").then((module) => ({ default: module.NotesEditor })),
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

function pageRows(pages: NotePage[], searching: boolean) {
  if (searching) return pages.map((page) => ({ page, depth: 0 }));
  const children = new Map<string | null, NotePage[]>();
  for (const page of pages) {
    const siblings = children.get(page.parentId) ?? [];
    siblings.push(page);
    children.set(page.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const rows: { page: NotePage; depth: number }[] = [];
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

export function NotesWorkspace({ trashed }: { trashed: boolean }) {
  const search = useSearch({ from: "/notes" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery(notesQuery(search.q, trashed));
  const selectedId = trashed ? undefined : search.page;
  const detail = useQuery(noteQuery(selectedId ?? ""));
  const [draft, setDraft] = useState<NoteDetail | null>(null);
  const draftRef = useRef<NoteDetail | null>(null);
  const loadedId = useRef<string | null>(null);
  const changed = useRef(0);
  const saved = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainPromise = useRef<Promise<boolean> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveUnavailable, setSaveUnavailable] = useState(false);
  const [actionError, setActionError] = useState("");
  const staleRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedId || !detail.data || loadedId.current === selectedId) return;
    loadedId.current = selectedId;
    draftRef.current = detail.data;
    setDraft(detail.data);
    changed.current = 0;
    saved.current = 0;
    staleRevision.current = null;
    setSaveState("saved");
    setSaveError("");
    setSaveConflict(false);
    setSaveUnavailable(false);
  }, [detail.data, selectedId]);

  const drain = useCallback(() => {
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
          const result = await saveNote({
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
              title: sequence === changed.current ? result.note.title : draftRef.current.title,
              revision: result.note.revision,
              updatedAt: result.note.updatedAt,
            };
            setDraft((current) =>
              current?.id === snapshot.id
                ? {
                    ...current,
                    title: sequence === changed.current ? result.note.title : current.title,
                    revision: result.note.revision,
                    updatedAt: result.note.updatedAt,
                  }
                : current,
            );
          }
          saved.current = sequence;
          staleRevision.current = null;
          setSaveConflict(false);
          setSaveUnavailable(false);
          queryClient.setQueryData(noteKeys.detail(snapshot.id), result.note);
          void queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
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
    (next: NoteDetail) => {
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
    disabled: trashed,
  });

  const rows = useMemo(() => pageRows(list.data ?? [], Boolean(search.q)), [list.data, search.q]);
  const selectPage = async (page: string | undefined) => {
    if (page === selectedId) return;
    if (!(await drain())) return;
    loadedId.current = null;
    await navigate({ to: "/notes", search: { q: search.q, page } });
  };

  const addPage = async (parentId: string | null) => {
    if (!(await drain())) return;
    try {
      const created = await createNote({ data: { title: "Untitled", parentId } });
      queryClient.setQueryData(noteKeys.detail(created.id), created);
      await queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      loadedId.current = null;
      setActionError("");
      await navigate({ to: "/notes", search: { q: undefined, page: created.id } });
    } catch (error) {
      setActionError(readableError(error, "The page could not be created."));
    }
  };

  const saveAsNewPage = async (openCopy = true) => {
    const snapshot = draftRef.current;
    if (!snapshot) return false;
    try {
      const created = await createNote({
        data: { title: snapshot.title.trim() || "Untitled", parentId: null },
      });
      const result = await saveNote({
        data: {
          id: created.id,
          title: snapshot.title.trim() || "Untitled",
          revision: created.revision,
          document: snapshot.document,
        },
      });
      if (!result.ok) throw new Error("The replacement page could not be saved.");
      loadedId.current = result.note.id;
      draftRef.current = result.note;
      setDraft(result.note);
      saved.current = changed.current;
      staleRevision.current = null;
      setSaveConflict(false);
      setSaveUnavailable(false);
      setSaveError("");
      setSaveState("saved");
      queryClient.setQueryData(noteKeys.detail(result.note.id), result.note);
      await queryClient.invalidateQueries({ queryKey: ["notes", "list"] });
      if (openCopy)
        await navigate({
          to: "/notes",
          search: { q: search.q, page: result.note.id },
        });
      return true;
    } catch (error) {
      setSaveError(
        readableError(
          error,
          "The replacement page could not be saved. Your text is still here.",
        ),
      );
      return false;
    }
  };

  if (trashed)
    return (
      <section aria-labelledby="trash-heading">
        <header className="page-header">
          <div>
            <h1 id="trash-heading" className="page-title">Trash</h1>
            <p className="page-description">Restore pages to their original place in the page tree.</p>
          </div>
        </header>
        <SearchBox value={search.q ?? ""} onChange={(q) => void navigate({ to: "/notes/trash", search: { q: q || undefined, page: undefined }, replace: true })} label="Search trash" />
        {actionError && <p className="mt-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{actionError}</p>}
        <div className="panel mt-4 divide-y">
          {list.isPending ? (
            <p className="p-4 text-muted-foreground">Loading trash…</p>
          ) : rows.length ? (
            rows.map(({ page }) => (
              <div key={page.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{page.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{page.preview || "Empty page"}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const result = await restoreNote({ data: { id: page.id, revision: page.revision } });
                      if (result.ok) {
                        setActionError("");
                        await queryClient.invalidateQueries({ queryKey: noteKeys.all });
                      } else {
                        setActionError("This page changed before it could be restored. The list has been refreshed.");
                        void list.refetch();
                      }
                    } catch (error) {
                      setActionError(readableError(error, "The page could not be restored."));
                    }
                  }}
                  aria-label={`Restore ${page.title}`}
                >
                  <RotateCcw /> Restore
                </Button>
              </div>
            ))
          ) : (
            <p className="p-6 text-center text-muted-foreground">{search.q ? "No trashed pages match your search." : "Trash is empty."}</p>
          )}
        </div>
      </section>
    );

  return (
    <section aria-labelledby="notes-heading">
      <header className="page-header">
        <div>
          <h1 id="notes-heading" className="page-title">Notes</h1>
          <p className="page-description">Keep formatted pages in a searchable tree.</p>
        </div>
        <Button onClick={() => void addPage(null)}><FilePlus2 /> New page</Button>
      </header>
      {actionError && (
        <p
          className="mt-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}
      <div className="notes-workspace mt-5">
        <aside className={`${selectedId ? "hidden md:flex" : "flex"} min-h-[34rem] flex-col border-r bg-card`} aria-label="Note pages">
          <SearchBox value={search.q ?? ""} onChange={(q) => void navigate({ to: "/notes", search: { q: q || undefined, page: selectedId }, replace: true })} label="Search pages" />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
        <div className={`${selectedId ? "block" : "hidden md:block"} min-w-0 bg-card`}>
          {!selectedId ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center text-muted-foreground">
              <div><FileText className="mx-auto mb-3 size-8" /><p>Choose a page or create one.</p></div>
            </div>
          ) : detail.isError ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center"><div><p role="alert">The page could not load.</p><Button className="mt-3" variant="outline" onClick={() => void detail.refetch()}>Reload page</Button></div></div>
          ) : !detail.isPending && detail.data === null ? (
            <div className="flex min-h-[34rem] items-center justify-center p-6 text-center">
              <div><p>This page is no longer available.</p><Button className="mt-3" variant="outline" onClick={() => void selectPage(undefined)}>Back to page list</Button></div>
            </div>
          ) : detail.isPending || !draft ? (
            <div className="min-h-[34rem] animate-pulse bg-muted" aria-label="Loading page" />
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back to page list" onClick={() => void selectPage(undefined)}><ArrowLeft /></Button>
                <Input
                  aria-label="Page title"
                  value={draft.title}
                  className="min-w-36 flex-1 border-transparent px-1 text-lg font-semibold shadow-none focus-visible:border-input"
                  onChange={(event) => scheduleSave({ ...draftRef.current!, title: event.target.value })}
                  onBlur={() => {
                    if (!draftRef.current?.title.trim()) scheduleSave({ ...draftRef.current!, title: "Untitled" });
                  }}
                />
                <span className={`text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`} role="status" aria-live="polite">
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Unsaved"}
                </span>
                {saveState === "error" && (
                  <Button variant="outline" size="sm" onClick={() => {
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
                  }}>{saveUnavailable ? "Save as new page" : saveConflict ? "Overwrite saved version" : "Try saving again"}</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void addPage(draft.id)} aria-label={`New subpage under ${draft.title}`}><FilePlus2 /> Subpage</Button>
                <Button variant="destructive" size="icon-sm" aria-label={`Move ${draft.title} to trash`} onClick={async () => {
                  if (!(await drain())) return;
                  const current = draftRef.current!;
                  try {
                    const result = await trashNote({ data: { id: current.id, revision: current.revision } });
                    if (!result.ok) {
                      setSaveState("error");
                      setSaveError("This page changed before it could be moved to trash.");
                      return;
                    }
                    await queryClient.invalidateQueries({ queryKey: noteKeys.all });
                    loadedId.current = null;
                    setActionError("");
                    await navigate({ to: "/notes", search: { q: search.q, page: undefined } });
                  } catch (error) {
                    setActionError(readableError(error, "The page could not be moved to trash."));
                  }
                }}><Trash2 /></Button>
              </div>
              {saveError && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">{saveError}</div>}
              <ClientOnly fallback={<div className="min-h-[30rem] animate-pulse bg-muted" aria-label="Loading editor" />}>
                <Suspense fallback={<div className="min-h-[30rem] animate-pulse bg-muted" aria-label="Loading editor" />}>
                  <NotesEditor key={draft.id} note={draft} onDocumentChange={(document: NoteBlock[]) => scheduleSave({ ...draftRef.current!, document })} />
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
              <Button onClick={async () => {
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
              }}>{saveUnavailable ? "Save copy and continue" : saveConflict ? "Overwrite and continue" : "Save and continue"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="relative m-3 block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search notes" className="pl-8" />
    </label>
  );
}

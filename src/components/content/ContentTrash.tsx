import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ContentPage } from "@/lib/content";
import { contentKeys, pagesQuery } from "@/queries/content";
import { deletePageForever, emptyContentTrash, restorePage } from "@/server/fns";
import { SearchBox } from "./SearchBox";

function message(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message.trim() : "";
  return text && text.length <= 240 && !text.startsWith("{") ? text : fallback;
}

/**
 * Trashed pages. Restoring puts a page back whole, so nothing it holds is
 * touched until it is deleted from here — that is the only action that lets go
 * of a page's uploaded files.
 */
export function ContentTrash() {
  const search = useSearch({ from: "/content" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery(pagesQuery(search.q, true));
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ContentPage | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const pages = list.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: contentKeys.all });

  const restore = async (page: ContentPage) => {
    try {
      const result = await restorePage({ data: { id: page.id, revision: page.revision } });
      if (!result.ok) {
        setError("This page changed before it could be restored. The list has been refreshed.");
        void list.refetch();
        return;
      }
      setError("");
      await refresh();
    } catch (caught) {
      setError(message(caught, "The page could not be restored."));
    }
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      const result =
        confirming === "all"
          ? await emptyContentTrash()
          : await deletePageForever({
              data: { id: confirming.id, revision: confirming.revision },
            });
      if (!result.ok) {
        setError("This page changed before it could be deleted. The list has been refreshed.");
        void list.refetch();
      } else {
        setError("");
        await refresh();
      }
      setConfirming(null);
    } catch (caught) {
      setError(message(caught, "The page could not be deleted."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="trash-heading">
      <header className="page-header">
        <div>
          <h1 id="trash-heading" className="page-title">Trash</h1>
          <p className="page-description">
            Restore pages to their original place in the page tree, with their images and
            files. Deleting a page from here is permanent.
          </p>
        </div>
        {pages.length > 0 && (
          <Button variant="outline" onClick={() => setConfirming("all")}>
            <Trash2 /> Empty trash
          </Button>
        )}
      </header>
      <SearchBox
        value={search.q ?? ""}
        onChange={(q) =>
          void navigate({
            to: "/content/trash",
            search: { ...search, q: q || undefined, page: undefined },
            replace: true,
          })
        }
        label="Search trash"
      />
      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="panel mt-4 divide-y">
        {list.isPending ? (
          <p className="p-4 text-muted-foreground">Loading trash…</p>
        ) : pages.length ? (
          pages.map((page) => (
            <div key={page.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{page.title}</p>
                <p className="truncate text-xs text-muted-foreground">{page.preview || "Empty page"}</p>
              </div>
              <Button variant="outline" onClick={() => void restore(page)} aria-label={`Restore ${page.title}`}>
                <RotateCcw /> Restore
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={() => setConfirming(page)}
                aria-label={`Delete ${page.title} permanently`}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-muted-foreground">
            {search.q ? "No trashed pages match your search." : "Trash is empty."}
          </p>
        )}
      </div>
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "all" ? "Empty the trash?" : "Delete this page permanently?"}
            </DialogTitle>
            <DialogDescription>
              {confirming === "all"
                ? "Every trashed page, its subpages, and the files only they use are deleted. This cannot be undone."
                : "The page, its subpages, and the files only they use are deleted. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
              {busy ? "Deleting…" : confirming === "all" ? "Empty trash" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

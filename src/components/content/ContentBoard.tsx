import { useMemo, useRef, useState } from "react";
import { ClientOnly, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  filterPages,
  groupPages,
  hasFilters,
  relativeTime,
  sortPages,
  type ContentGroupBucket,
  type ContentPage,
  type ContentProperties,
} from "@/lib/content";
import { contentKeys, contentPropertiesQuery, invalidateContent, pagesQuery } from "@/queries/content";
import { createPage, movePageCard } from "@/server/fns";
import { ContentToolbar, type ToolbarPatch } from "./ContentToolbar";
import { chipClass, Dot, byId } from "./properties";

const NONE = "none";
const keyOf = (bucket: ContentGroupBucket) => bucket.id ?? NONE;

/**
 * A drag id is unique per card *slot*, not per page: grouped by tag, one page
 * sits in a column for every tag it carries, and dnd-kit keys its registry by
 * id — the same id twice leaves one of the two cards without a measured node,
 * so the wrong card moves.
 */
const slotId = (column: string, pageId: string) => `${column}/${pageId}`;
const pageOf = (id: string) => id.slice(id.indexOf("/") + 1);

type MovePatch = {
  id: string;
  orderedIds: string[];
  statusId?: string;
  typeId?: string | null;
  addTagId?: string;
  removeTagId?: string;
  tagIds?: string[];
};

/** The column a drag id belongs to: a column id itself, or a card's column. */
function columnOf(list: ContentGroupBucket[], id: string) {
  const separator = id.indexOf("/");
  const key = separator < 0 ? id : id.slice(0, separator);
  return list.some((bucket) => keyOf(bucket) === key) ? key : null;
}

export function ContentBoard() {
  const search = useSearch({ from: "/content" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pages = useQuery(pagesQuery());
  const propertyQuery = useQuery(contentPropertiesQuery);
  const [local, setLocal] = useState<ContentGroupBucket[] | null>(null);
  const [dragged, setDragged] = useState<ContentPage | null>(null);
  const source = useRef<string | null>(null);
  const [error, setError] = useState("");

  const properties: ContentProperties = propertyQuery.data ?? {
    statuses: [],
    types: [],
    tags: [],
  };
  const group = search.group ?? "status";
  const sort = search.sort ?? "manual";

  const computed = useMemo(
    () =>
      groupPages(
        sortPages(filterPages(pages.data ?? [], search), sort),
        group,
        properties,
        { hideEmpty: search.columns === "filled" },
      ),
    [pages.data, properties, group, sort, search],
  );
  const buckets = local ?? computed;

  const update = (patch: ToolbarPatch) =>
    void navigate({
      to: "/content/board",
      search: { ...search, ...patch },
      replace: true,
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Cards show the page they sit under, so a subpage is not mistaken for a
  // second copy of its parent's work.
  const parentTitles = useMemo(() => {
    const titles = new Map((pages.data ?? []).map((page) => [page.id, page.title]));
    return (page: ContentPage) =>
      page.parentId ? titles.get(page.parentId) : undefined;
  }, [pages.data]);

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const page = (pages.data ?? []).find((item) => item.id === pageOf(id)) ?? null;
    setDragged(page);
    source.current = columnOf(computed, id);
    setLocal(computed);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    setLocal((current) => {
      const list = current ?? computed;
      const from = columnOf(list, String(active.id));
      const to = columnOf(list, String(over.id));
      if (!from || !to || from === to) return list;
      const activePage = pageOf(String(active.id));
      const moving = list
        .find((bucket) => keyOf(bucket) === from)!
        .pages.find((page) => page.id === activePage);
      if (!moving) return list;
      const overPage = pageOf(String(over.id));
      return list.map((bucket) => {
        if (keyOf(bucket) === from)
          return {
            ...bucket,
            pages: bucket.pages.filter((page) => page.id !== moving.id),
          };
        if (keyOf(bucket) !== to) return bucket;
        const overIndex = bucket.pages.findIndex((page) => page.id === overPage);
        const next = [...bucket.pages];
        next.splice(overIndex < 0 ? next.length : overIndex, 0, moving);
        return { ...bucket, pages: next };
      });
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = pageOf(String(active.id));
    setDragged(null);
    if (!over) {
      setLocal(null);
      return;
    }
    const list = local ?? computed;
    const target = columnOf(list, String(over.id));
    if (!target) {
      setLocal(null);
      return;
    }
    const overPage = pageOf(String(over.id));
    // Placed rather than swapped: a card that crossed columns was already put
    // where it is being shown by `onDragOver`, and moving it again from there
    // would land it one place past what the drag preview promised. Lifting it
    // out and dropping it at the card it is over says the same thing for a
    // reorder inside one column, and the same thing twice for a crossing.
    const arranged = list.map((bucket) => {
      if (keyOf(bucket) !== target) return bucket;
      const moving = bucket.pages.find((page) => page.id === activeId);
      if (!moving) return bucket;
      const rest = bucket.pages.filter((page) => page.id !== activeId);
      const at = rest.findIndex((page) => page.id === overPage);
      rest.splice(at < 0 ? rest.length : at, 0, moving);
      return { ...bucket, pages: rest };
    });
    setLocal(arranged);
    const column = arranged.find((bucket) => keyOf(bucket) === target)!;
    const from = source.current;
    source.current = null;
    void commit(activeId, target, from, column.pages.map((page) => page.id));
  };

  const commit = async (
    id: string,
    target: string,
    from: string | null,
    orderedIds: string[],
  ) => {
    const patch: MovePatch = {
      id,
      orderedIds: sort === "manual" ? orderedIds : [],
    };
    if (group === "status" && target !== NONE) patch.statusId = target;
    if (group === "type") patch.typeId = target === NONE ? null : target;
    if (group === "tag" && from !== target) {
      // Untagged means no tags at all. Dropping a card there while only
      // dropping the column it came from would leave it in its other tag
      // columns and never in the one it was dragged to.
      if (target === NONE) patch.tagIds = [];
      else {
        if (from && from !== NONE) patch.removeTagId = from;
        patch.addTagId = target;
      }
    }
    try {
      const result = await movePageCard({ data: patch });
      if (!result.ok) setError("That card could not be moved. The board has been refreshed.");
      else setError("");
    } catch {
      setError("That card could not be moved. The board has been refreshed.");
    }
    await invalidateContent(queryClient);
    setLocal(null);
  };

  const addCard = async (bucket: ContentGroupBucket) => {
    try {
      // Created with its column's property, not created and then moved into
      // it: a second request that fails would leave an untitled, untagged page
      // behind and report that nothing was created.
      const created = await createPage({
        data: {
          title: "Untitled",
          statusId: group === "status" ? bucket.id : null,
          typeId: group === "type" ? bucket.id : null,
          tagIds: group === "tag" && bucket.id ? [bucket.id] : [],
        },
      });
      queryClient.setQueryData(contentKeys.detail(created.id), created);
      await invalidateContent(queryClient);
      await navigate({ to: "/content", search: { ...search, page: created.id } });
    } catch {
      setError("The page could not be created.");
    }
  };

  const total = buckets.reduce((sum, bucket) => sum + bucket.pages.length, 0);

  return (
    <section aria-label="Board" className="space-y-5">
      <ContentToolbar
        properties={properties}
        search={search}
        onChange={update}
        board
      />
      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {pages.isPending || propertyQuery.isPending ? (
        <div className="h-[28rem] animate-pulse rounded-xl bg-muted" aria-label="Loading board" />
      ) : total === 0 && hasFilters(search) ? (
        <p className="card p-10 text-center text-muted-foreground">
          No pages match these filters.
        </p>
      ) : (
        <ClientOnly
          fallback={
            <div className="h-[28rem] animate-pulse rounded-xl bg-muted" aria-label="Loading board" />
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDragged(null);
              setLocal(null);
            }}
          >
            <div className="flex gap-3 overflow-x-auto pb-3">
              {buckets.map((bucket) => (
                <Column
                  key={keyOf(bucket)}
                  bucket={bucket}
                  properties={properties}
                  sortable={sort === "manual"}
                  parentTitle={parentTitles}
                  onAdd={() => void addCard(bucket)}
                  onOpen={(id) =>
                    void navigate({ to: "/content", search: { ...search, page: id } })
                  }
                />
              ))}
            </div>
            <DragOverlay>
              {dragged ? (
                <Card
                  page={dragged}
                  properties={properties}
                  parentTitle={parentTitles(dragged)}
                  overlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </ClientOnly>
      )}
    </section>
  );
}

function Column({
  bucket,
  properties,
  sortable,
  parentTitle,
  onAdd,
  onOpen,
}: {
  bucket: ContentGroupBucket;
  properties: ContentProperties;
  sortable: boolean;
  parentTitle: (page: ContentPage) => string | undefined;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: keyOf(bucket) });
  return (
    <section
      className={`flex w-[17rem] shrink-0 flex-col rounded-xl border bg-card transition-colors ${
        isOver ? "border-primary/50 bg-accent/40" : ""
      }`}
      aria-label={bucket.label}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <Dot color={bucket.color} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{bucket.label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {bucket.pages.length}
        </span>
      </header>
      <div ref={setNodeRef} className="min-h-24 flex-1 space-y-2 px-2 pb-2">
        <SortableContext
          items={bucket.pages.map((page) => slotId(keyOf(bucket), page.id))}
          strategy={verticalListSortingStrategy}
        >
          {bucket.pages.map((page) => (
            <SortableCard
              key={page.id}
              id={slotId(keyOf(bucket), page.id)}
              page={page}
              properties={properties}
              sortable={sortable}
              parentTitle={parentTitle(page)}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
        {bucket.pages.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nothing here yet
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="m-2 mt-0 justify-start text-muted-foreground"
        onClick={onAdd}
      >
        <Plus /> New
      </Button>
    </section>
  );
}

function SortableCard({
  id,
  page,
  properties,
  sortable,
  parentTitle,
  onOpen,
}: {
  id: string;
  page: ContentPage;
  properties: ContentProperties;
  sortable: boolean;
  parentTitle?: string;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-40" : ""}
      {...attributes}
      {...listeners}
    >
      <Card
        page={page}
        properties={properties}
        parentTitle={parentTitle}
        onOpen={onOpen}
        hint={sortable ? undefined : "Switch sort to Manual to reorder cards by hand"}
      />
    </div>
  );
}

function Card({
  page,
  properties,
  parentTitle,
  onOpen,
  overlay = false,
  hint,
}: {
  page: ContentPage;
  properties: ContentProperties;
  parentTitle?: string;
  onOpen?: (id: string) => void;
  overlay?: boolean;
  hint?: string;
}) {
  const type = byId(properties.types, page.typeId);
  return (
    <article
      className={`rounded-lg border bg-background p-2.5 text-left shadow-xs ${
        overlay ? "rotate-1 shadow-lg" : "hover:border-primary/40"
      }`}
      title={hint}
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onOpen?.(page.id)}
      >
        {parentTitle && (
          <span className="block truncate text-[0.7rem] text-muted-foreground">
            {parentTitle}
          </span>
        )}
        <span className="block text-sm font-medium break-words">{page.title}</span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {type && (
          <span
            className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium ${chipClass(type.color)}`}
          >
            <span className="truncate">{type.name}</span>
          </span>
        )}
        {page.tagIds
          .map((id) => byId(properties.tags, id))
          .filter((tag) => tag !== undefined)
          .map((tag) => (
            <span
              key={tag.id}
              className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium ${chipClass(tag.color)}`}
            >
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
        <span className="ml-auto text-[0.7rem] text-muted-foreground">
          {relativeTime(page.updatedAt)}
        </span>
      </div>
    </article>
  );
}

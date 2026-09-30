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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canDropOnColumn,
  displayPageTitle,
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
import { PageIcon } from "./PageTypeIcon";

const NONE = "none";
const keyOf = (bucket: ContentGroupBucket) => bucket.id ?? NONE;
/** The status a column stands for, or null for the column that collects the pages with none. */
const propertyOf = (column: string | null) => (column === NONE ? null : column);

type MovePatch = {
  id: string;
  orderedIds: string[];
  statusId?: string;
};

/**
 * The column a drag id belongs to: a column id itself, or the column holding
 * that card. A card's drag id is its page id, which stays the same when the
 * preview carries it into another column, so dnd-kit never loses the card
 * being dragged. The board groups by status, so a page is in one column only.
 */
function columnOf(list: ContentGroupBucket[], id: string) {
  const column = list.find(
    (bucket) =>
      keyOf(bucket) === id || bucket.pages.some((page) => page.id === id),
  );
  return column ? keyOf(column) : null;
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
    subpageTypes: [],
  };
  const group = "status" as const;
  const sort = search.sort ?? "manual";

  // The board is the pipeline: statuses only apply to top-level pages, so
  // subpages never show up here. They are managed from the page above them.
  const topLevel = useMemo(
    () => (pages.data ?? []).filter((page) => page.parentId === null),
    [pages.data],
  );

  const computed = useMemo(
    () =>
      groupPages(
        sortPages(filterPages(topLevel, search), sort),
        group,
        properties,
        { hideEmpty: search.columns === "filled" },
      ),
    [topLevel, properties, group, sort, search],
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

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const page = topLevel.find((item) => item.id === id) ?? null;
    setDragged(page);
    source.current = columnOf(computed, id);
    setLocal(computed);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    // Past the middle of the card it is over, the card goes after it.
    const translated = active.rect.current.translated;
    const below =
      translated !== null && translated.top > over.rect.top + over.rect.height / 2;
    setLocal((current) => {
      const list = current ?? computed;
      const from = columnOf(list, String(active.id));
      const to = columnOf(list, String(over.id));
      if (!from || !to || from === to) return list;
      const activePage = String(active.id);
      const moving = list
        .find((bucket) => keyOf(bucket) === from)!
        .pages.find((page) => page.id === activePage);
      if (!moving) return list;
      // The preview never shows a move the drop would refuse.
      if (!canDropOnColumn(moving, group, propertyOf(from), propertyOf(to))) return list;
      const overPage = String(over.id);
      return list.map((bucket) => {
        if (keyOf(bucket) === from)
          return {
            ...bucket,
            pages: bucket.pages.filter((page) => page.id !== moving.id),
          };
        if (keyOf(bucket) !== to) return bucket;
        const overIndex = bucket.pages.findIndex((page) => page.id === overPage);
        const next = [...bucket.pages];
        next.splice(overIndex < 0 ? next.length : overIndex + (below ? 1 : 0), 0, moving);
        return { ...bucket, pages: next };
      });
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);
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
    // A top-level page dropped on the "No status" column has nowhere to go:
    // the board cannot take its status away, so the card goes back.
    const activePage = topLevel.find((page) => page.id === activeId);
    if (
      activePage &&
      !canDropOnColumn(activePage, group, propertyOf(source.current), propertyOf(target))
    ) {
      source.current = null;
      setLocal(null);
      return;
    }
    const overPage = String(over.id);
    // A card that crossed columns was already put in its new column by
    // `onDragOver`; what is left is the move within the column, which is what
    // the sortable preview shows: the card takes the place of the one it is
    // over. Dropped on the column itself, it stays where the preview put it.
    const arranged = list.map((bucket) => {
      if (keyOf(bucket) !== target) return bucket;
      const from = bucket.pages.findIndex((page) => page.id === activeId);
      const to = bucket.pages.findIndex((page) => page.id === overPage);
      if (from < 0 || to < 0 || from === to) return bucket;
      return { ...bucket, pages: arrayMove(bucket.pages, from, to) };
    });
    setLocal(arranged);
    const column = arranged.find((bucket) => keyOf(bucket) === target)!;
    source.current = null;
    void commit(activeId, target, column.pages.map((page) => page.id));
  };

  const commit = async (
    id: string,
    target: string,
    orderedIds: string[],
  ) => {
    const patch: MovePatch = {
      id,
      orderedIds: sort === "manual" ? orderedIds : [],
    };
    if (target !== NONE) patch.statusId = target;
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
      // Created with its column's status, not created and then moved into
      // it: a second request that fails would leave an untitled page behind
      // and report that nothing was created.
      const created = await createPage({
        data: {
          title: "",
          statusId: bucket.id,
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
                  // Nothing can be created without a status, so the
                  // "No status" column has nothing to offer here.
                  onAdd={
                    bucket.id === null
                      ? undefined
                      : () => void addCard(bucket)
                  }
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
  onAdd,
  onOpen,
}: {
  bucket: ContentGroupBucket;
  properties: ContentProperties;
  sortable: boolean;
  /** Absent on a column that cannot be created into. */
  onAdd?: () => void;
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
          items={bucket.pages.map((page) => page.id)}
          strategy={verticalListSortingStrategy}
        >
          {bucket.pages.map((page) => (
            <SortableCard
              key={page.id}
              id={page.id}
              page={page}
              properties={properties}
              sortable={sortable}
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
      {onAdd && (
        <Button
          variant="ghost"
          size="sm"
          className="m-2 mt-0 justify-start text-muted-foreground"
          onClick={onAdd}
        >
          <Plus /> New
        </Button>
      )}
    </section>
  );
}

function SortableCard({
  id,
  page,
  properties,
  sortable,
  onOpen,
}: {
  id: string;
  page: ContentPage;
  properties: ContentProperties;
  sortable: boolean;
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
        onOpen={onOpen}
        hint={sortable ? undefined : "Switch sort to Manual to reorder cards by hand"}
      />
    </div>
  );
}

function Card({
  page,
  properties,
  onOpen,
  overlay = false,
  hint,
}: {
  page: ContentPage;
  properties: ContentProperties;
  onOpen?: (id: string) => void;
  overlay?: boolean;
  hint?: string;
}) {
  const types = page.typeIds
    .map((id) => byId(properties.types, id))
    .filter((type) => type !== undefined);
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
        <span className="flex items-start gap-1.5 text-sm font-medium break-words">
          <PageIcon page={page} properties={properties} className="mt-px" />
          <span className="min-w-0">{displayPageTitle(page.title)}</span>
        </span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {types.map((type) => (
          <span
            key={type.id}
            className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium ${chipClass(type.color)}`}
          >
            <span className="truncate">{type.name}</span>
          </span>
        ))}
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

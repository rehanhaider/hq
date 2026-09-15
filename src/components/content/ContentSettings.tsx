import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import {
  PROPERTY_COLORS,
  type Property,
  type PropertyColor,
  type PropertyKind,
} from "@/lib/content";
import { contentKeys, contentPropertiesQuery, invalidateContent, pagesQuery } from "@/queries/content";
import {
  createContentProperty,
  deleteContentProperty,
  reorderContentProperties,
  updateContentProperty,
} from "@/server/fns";
import { Dot } from "./properties";

type Section = {
  kind: PropertyKind;
  title: string;
  description: string;
  addLabel: string;
};

const SECTIONS: Section[] = [
  {
    kind: "status",
    title: "Statuses",
    description: "The board's columns, in order. Every page has one.",
    addLabel: "New status",
  },
  {
    kind: "type",
    title: "Types",
    description: "What a page is: a stream, a video, an article. A page can carry more than one.",
    addLabel: "New type",
  },
  {
    kind: "tag",
    title: "Tags",
    description: "Free labels. A page can carry any number.",
    addLabel: "New tag",
  },
];

export function ContentSettings() {
  const queryClient = useQueryClient();
  const properties = useQuery(contentPropertiesQuery);
  const pages = useQuery(pagesQuery());
  const [error, setError] = useState("");

  const refresh = async () => {
    await invalidateContent(queryClient, contentKeys.all);
  };

  const lists: Record<PropertyKind, Property[]> = {
    status: properties.data?.statuses ?? [],
    type: properties.data?.types ?? [],
    tag: properties.data?.tags ?? [],
  };

  const counts = (kind: PropertyKind, id: string) =>
    (pages.data ?? []).filter((page) =>
      kind === "status"
        ? page.statusId === id
        : kind === "type"
          ? page.typeIds.includes(id)
          : page.tagIds.includes(id),
    ).length;

  return (
    <section aria-label="Content settings" className="space-y-6">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {properties.isPending ? (
        <p className="py-16 text-center text-muted-foreground">Loading properties…</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {SECTIONS.map((section) => (
            <PropertyList
              key={section.kind}
              section={section}
              items={lists[section.kind]}
              statuses={lists.status}
              count={(id) => counts(section.kind, id)}
              onError={setError}
              onDone={refresh}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PropertyList({
  section,
  items,
  statuses,
  count,
  onError,
  onDone,
}: {
  section: Section;
  items: Property[];
  statuses: Property[];
  count: (id: string) => number;
  onError: (message: string) => void;
  onDone: () => Promise<void>;
}) {
  const [adding, setAdding] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Property | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [moveTo, setMoveTo] = useState("");

  const run = async (work: () => Promise<{ ok?: boolean }>, message: string) => {
    try {
      const result = await work();
      if (result.ok === false) {
        onError(message);
        return false;
      }
      onError("");
      await onDone();
      return true;
    } catch {
      onError(message);
      return false;
    }
  };

  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    if (
      await run(
        () => createContentProperty({ data: { kind: section.kind, name } }),
        `${section.title} could not be added.`,
      )
    )
      setAdding("");
  };

  const move = (index: number, delta: number) => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    void run(
      () =>
        reorderContentProperties({
          data: { kind: section.kind, ids: next.map((entry) => entry.id) },
        }),
      "The order could not be saved.",
    );
  };

  const remove = async (property: Property, target?: string) => {
    let result;
    try {
      result = await deleteContentProperty({
        data: { kind: section.kind, id: property.id, moveToId: target ?? null },
      });
    } catch {
      onError(`${property.name} could not be deleted.`);
      return;
    }
    if (result.ok) {
      onError("");
      setPendingDelete(null);
      await onDone();
      return;
    }
    if (result.code === "pages") {
      setMoveTo(statuses.find((status) => status.id !== property.id)?.id ?? "");
      setPendingCount(result.pages);
      setPendingDelete(property);
      return;
    }
    onError(
      result.code === "last"
        ? "The last status cannot be deleted — the board needs at least one column."
        : `${property.name} could not be deleted.`,
    );
  };

  return (
    <section className="card flex flex-col">
      <header className="border-b px-4 py-3">
        <h2 className="section-title">{section.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{section.description}</p>
      </header>
      <ul className="divide-y">
        {items.map((property, index) => (
          <li key={property.id} className="flex items-center gap-1 px-2 py-1.5">
            <ColorPicker
              property={property}
              onPick={(color) =>
                void run(
                  () =>
                    updateContentProperty({
                      data: { kind: section.kind, id: property.id, color },
                    }),
                  "The colour could not be saved.",
                )
              }
            />
            <NameField
              property={property}
              onRename={(name) =>
                void run(
                  () =>
                    updateContentProperty({
                      data: { kind: section.kind, id: property.id, name },
                    }),
                  "The name could not be saved.",
                )
              }
            />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {count(property.id) || ""}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${property.name} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${property.name} down`}
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${property.name}`}
              disabled={section.kind === "status" && items.length <= 1}
              onClick={() => void remove(property)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            Nothing here yet.
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2 border-t p-2">
        <Input
          value={adding}
          placeholder={section.addLabel}
          aria-label={section.addLabel}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
          }}
        />
        <Button size="sm" disabled={!adding.trim()} onClick={() => void add()}>
          <Plus /> Add
        </Button>
      </div>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move these pages first</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `${pendingCount} ${pendingCount === 1 ? "page is" : "pages are"} in ${pendingDelete.name}. Choose where they go.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="section-label">Move pages to</span>
            <select
              className="field mt-2 w-full"
              value={moveTo}
              aria-label="Move pages to"
              onChange={(event) => setMoveTo(event.target.value)}
            >
              {statuses
                .filter((status) => status.id !== pendingDelete?.id)
                .map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
            </select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!moveTo}
              onClick={() => {
                if (pendingDelete) void remove(pendingDelete, moveTo);
              }}
            >
              Move and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function NameField({
  property,
  onRename,
}: {
  property: Property;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(property.name);
  useEffect(() => setName(property.name), [property.name]);
  const commit = () => {
    const next = name.trim();
    if (!next) {
      setName(property.name);
      return;
    }
    if (next !== property.name) onRename(next);
  };
  return (
    <Input
      value={name}
      aria-label={`Rename ${property.name}`}
      className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 font-medium shadow-none focus-visible:border-input dark:bg-transparent"
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setName(property.name);
      }}
    />
  );
}

function ColorPicker({
  property,
  onPick,
}: {
  property: Property;
  onPick: (color: PropertyColor) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Colour of ${property.name}`}>
            <Dot color={property.color} className="size-3.5" />
          </Button>
        }
      />
      <MenuContent className="min-w-0">
        <MenuLabel>Colour</MenuLabel>
        <div className="grid grid-cols-3 gap-1 p-1">
          {PROPERTY_COLORS.map((color) => (
            <MenuItem
              key={color}
              className="min-h-8 justify-center px-2"
              aria-current={color === property.color ? "page" : undefined}
              onClick={() => onPick(color)}
            >
              <Dot color={color} className="size-3.5" />
              <span className="sr-only">{color}</span>
            </MenuItem>
          ))}
        </div>
      </MenuContent>
    </Menu>
  );
}

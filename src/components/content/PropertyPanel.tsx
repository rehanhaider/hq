import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleDashed, Plus, Shapes, Tag as TagIcon, X } from "lucide-react";
import { cn } from "cn";
import {
  splitTagNames,
  type ContentPage,
  type ContentProperties,
  type Property,
} from "@/lib/content";
import { chipClass } from "./properties";

export type PropertyPatch = {
  statusId?: string;
  typeIds?: string[];
  tagIds?: string[];
};

/**
 * The page's properties, written into the document the way Notion does it: a
 * label column, a value that opens a picker in place, and nothing that looks
 * like a form. Every change is saved on its own, immediately, without touching
 * the document or its revision.
 */
export function PropertyPanel({
  page,
  properties,
  disabled = false,
  onChange,
  onCreateTag,
}: {
  page: ContentPage;
  properties: ContentProperties;
  disabled?: boolean;
  onChange: (patch: PropertyPatch) => void;
  onCreateTag: (name: string) => Promise<string[] | null>;
}) {
  const status = properties.statuses.find((entry) => entry.id === page.statusId);
  const types = page.typeIds
    .map((id) => properties.types.find((entry) => entry.id === id))
    .filter((type) => type !== undefined);
  const tags = page.tagIds
    .map((id) => properties.tags.find((entry) => entry.id === id))
    .filter((tag) => tag !== undefined);

  return (
    <dl className="mt-4 space-y-0.5">
      <Row icon={<CircleDashed />} label="Status">
        <Picker
          disabled={disabled}
          label="Status"
          value={status ? <Pill property={status} /> : <Empty>Empty</Empty>}
        >
          {(close) =>
            properties.statuses.map((option) => (
              <Option
                key={option.id}
                property={option}
                selected={option.id === page.statusId}
                onSelect={() => {
                  onChange({ statusId: option.id });
                  close();
                }}
              />
            ))
          }
        </Picker>
      </Row>
      <Row icon={<Shapes />} label="Type">
        <Picker
          disabled={disabled}
          label="Type"
          value={
            types.length === 0 ? (
              <Empty>Empty</Empty>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                {types.map((type) => (
                  <Pill key={type.id} property={type} />
                ))}
              </span>
            )
          }
        >
          {(close) => (
            <>
              {properties.types.map((option) => (
                <Option
                  key={option.id}
                  property={option}
                  selected={page.typeIds.includes(option.id)}
                  onSelect={() => {
                    onChange({
                      typeIds: page.typeIds.includes(option.id)
                        ? page.typeIds.filter((id) => id !== option.id)
                        : [...page.typeIds, option.id],
                    });
                  }}
                />
              ))}
              {page.typeIds.length > 0 && (
                <button
                  type="button"
                  className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    onChange({ typeIds: [] });
                    close();
                  }}
                >
                  <X className="size-3.5" /> Clear
                </button>
              )}
            </>
          )}
        </Picker>
      </Row>
      <Row icon={<TagIcon />} label="Tags">
        <TagPicker
          page={page}
          properties={properties}
          disabled={disabled}
          tags={tags}
          onChange={onChange}
          onCreateTag={onCreateTag}
        />
      </Row>
    </dl>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-2">
      <dt className="flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Pill({ property }: { property: Property }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-sm font-medium",
        chipClass(property.color),
      )}
    >
      <span className="truncate">{property.name}</span>
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted-foreground/70">{children}</span>;
}

function Option({
  property,
  selected,
  onSelect,
}: {
  property: Property;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-muted"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <Pill property={property} />
      {selected && <Check className="ml-auto size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** A value that opens its options in place, and closes on Escape or outside click. */
function Picker({
  label,
  value,
  disabled,
  children,
  trigger,
}: {
  label: string;
  value?: ReactNode;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
  trigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
  }, [open]);

  return (
    <div className="relative">
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
          onClick={() => setOpen(true)}
        >
          {value}
        </button>
      )}
      {open && (
        <>
          <button
            type="button"
            aria-label={`Close ${label.toLowerCase()} options`}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panel}
            className="absolute top-full left-0 z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl bg-popover p-1 ring-1 shadow-lg ring-foreground/10"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

function TagPicker({
  page,
  properties,
  tags,
  disabled,
  onChange,
  onCreateTag,
}: {
  page: ContentPage;
  properties: ContentProperties;
  tags: Property[];
  disabled: boolean;
  onChange: (patch: PropertyPatch) => void;
  onCreateTag: (name: string) => Promise<string[] | null>;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const term = query.trim();
  const names = splitTagNames(term);
  const multi = names.length > 1;
  const matches = properties.tags.filter((tag) =>
    tag.name.toLowerCase().includes(term.toLowerCase()),
  );
  const exact = multi
    ? undefined
    : properties.tags.find((tag) => tag.name.toLowerCase() === term.toLowerCase());

  const toggle = (id: string) =>
    onChange({
      tagIds: page.tagIds.includes(id)
        ? page.tagIds.filter((tagId) => tagId !== id)
        : [...page.tagIds, id],
    });

  const create = async () => {
    if (!term || busy) return;
    setBusy(true);
    try {
      const ids = await onCreateTag(term);
      if (ids?.length) {
        const missing = ids.filter((id) => !page.tagIds.includes(id));
        if (missing.length) onChange({ tagIds: [...page.tagIds, ...missing] });
      }
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Picker
      label="Tags"
      disabled={disabled}
      trigger={(open) => (
        <button
          type="button"
          disabled={disabled}
          aria-label="Tags"
          className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
          onClick={open}
        >
          {tags.length === 0 ? (
            <Empty>Empty</Empty>
          ) : (
            tags.map((tag) => <Pill key={tag.id} property={tag} />)
          )}
        </button>
      )}
    >
      {() => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            className="mb-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus:border-ring"
            value={query}
            placeholder="Find or create a tag"
            aria-label="Find or create a tag"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (exact) toggle(exact.id);
              else void create();
            }}
          />
          {matches.map((tag) => (
            <Option
              key={tag.id}
              property={tag}
              selected={page.tagIds.includes(tag.id)}
              onSelect={() => toggle(tag.id)}
            />
          ))}
          {term && !exact && (
            <button
              type="button"
              className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted"
              disabled={busy}
              onClick={() => void create()}
            >
              <Plus className="size-3.5" />{" "}
              {multi ? `Create ${names.length} tags` : `Create “${term}”`}
            </button>
          )}
          {!matches.length && !term && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No tags yet. Type a name to create one.
            </p>
          )}
        </div>
      )}
    </Picker>
  );
}

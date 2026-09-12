import { Columns3, ListFilter, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  GROUPS,
  SORTS,
  hasFilters,
  type ContentGroup,
  type ContentProperties,
  type ContentSearch,
  type ContentSort,
  type Property,
} from "@/lib/content";
import { Dot } from "./properties";

const SORT_LABELS: Record<ContentSort, string> = {
  manual: "Manual",
  updated: "Updated",
  created: "Created",
  title: "Title",
};

const GROUP_LABELS: Record<ContentGroup, string> = {
  status: "Status",
  type: "Type",
  tag: "Tag",
};

export type ToolbarPatch = Partial<ContentSearch>;

/**
 * Filters, sort, and grouping. Everything here writes to the URL, so a board
 * someone is looking at is a link they can send or bookmark.
 */
export function ContentToolbar({
  properties,
  search,
  onChange,
  board = false,
}: {
  properties: ContentProperties;
  search: ContentSearch;
  onChange: (patch: ToolbarPatch) => void;
  board?: boolean;
}) {
  const sort = search.sort ?? "manual";
  const group = search.group ?? "status";
  const filtered = hasFilters(search);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-44 flex-1 sm:max-w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search titles"
          placeholder="Search"
          className="pl-8"
          value={search.q ?? ""}
          onChange={(event) => onChange({ q: event.target.value || undefined })}
        />
      </label>
      <PropertyFilter
        label="Status"
        options={properties.statuses}
        selected={search.status ?? []}
        onChange={(status) => onChange({ status })}
      />
      <PropertyFilter
        label="Type"
        options={properties.types}
        selected={search.type ?? []}
        onChange={(type) => onChange({ type })}
      />
      <PropertyFilter
        label="Tag"
        options={properties.tags}
        selected={search.tag ?? []}
        onChange={(tag) => onChange({ tag })}
      />
      {board && (
        <Menu>
          <MenuTrigger
            render={
              <Button variant="outline" size="sm">
                <Columns3 /> Group: {GROUP_LABELS[group]}
              </Button>
            }
          />
          <MenuContent>
            <MenuLabel>Group by</MenuLabel>
            {GROUPS.map((option) => (
              <MenuItem
                key={option}
                aria-current={group === option ? "page" : undefined}
                onClick={() =>
                  onChange({ group: option === "status" ? undefined : option })
                }
              >
                {GROUP_LABELS[option]}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuCheckboxItem
              checked={search.columns === "filled"}
              onCheckedChange={(checked) =>
                onChange({ columns: checked ? "filled" : undefined })
              }
            >
              Hide empty columns
            </MenuCheckboxItem>
          </MenuContent>
        </Menu>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button variant="outline" size="sm">
              <SlidersHorizontal /> Sort: {SORT_LABELS[sort]}
            </Button>
          }
        />
        <MenuContent>
          <MenuLabel>Sort by</MenuLabel>
          {SORTS.map((option) => (
            <MenuItem
              key={option}
              aria-current={sort === option ? "page" : undefined}
              onClick={() =>
                onChange({ sort: option === "manual" ? undefined : option })
              }
            >
              {SORT_LABELS[option]}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            onChange({ q: undefined, status: undefined, type: undefined, tag: undefined })
          }
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

function PropertyFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Property[];
  selected: string[];
  onChange: (value: string[] | undefined) => void;
}) {
  const chosen = selected.filter((id) => options.some((option) => option.id === id));
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={options.length === 0}>
            <ListFilter /> {label}
            {chosen.length > 0 && (
              <span className="rounded bg-primary/15 px-1 text-[0.7rem] font-semibold text-primary">
                {chosen.length}
              </span>
            )}
          </Button>
        }
      />
      <MenuContent>
        <MenuLabel>{label}</MenuLabel>
        {options.map((option) => (
          <MenuCheckboxItem
            key={option.id}
            checked={chosen.includes(option.id)}
            onCheckedChange={(checked) => {
              const next = checked
                ? [...chosen, option.id]
                : chosen.filter((id) => id !== option.id);
              onChange(next.length ? next : undefined);
            }}
          >
            <Dot color={option.color} />
            <span className="truncate">{option.name}</span>
          </MenuCheckboxItem>
        ))}
        {chosen.length > 0 && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange(undefined)}>Clear {label.toLowerCase()}</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

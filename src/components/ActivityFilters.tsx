import { useState } from "react";
import { ChevronDown, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { monthsBefore, rangeLabel } from "@/lib/activity";
import { daysAgo } from "@/lib/model";
import type { Filters } from "@/lib/model";
export function ActivityFilters({
  filters,
  repositories,
  onChange,
}: {
  filters: Filters;
  repositories: { fullName: string }[];
  onChange: (patch: Partial<Filters>) => void;
}) {
  const names = repositories.map((repo) => repo.fullName).sort();
  const selected = new Set(
    filters.repo === "all"
      ? names
      : Array.isArray(filters.repo)
        ? filters.repo
        : [filters.repo],
  );
  const groups = [...new Set(names.map((name) => name.split("/")[0]!))];
  const toggle = (items: string[], checked: boolean) => {
    const next = new Set(selected);
    items.forEach((name) => (checked ? next.add(name) : next.delete(name)));
    onChange({ repo: next.size === names.length ? "all" : [...next].sort() });
  };
  const [open, setOpen] = useState(false);
  const weekFrom = (weeks: number) =>
    new Date(Date.parse(`${filters.to}T00:00:00Z`) - (weeks * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const active = [1, 3, 6, 12, 24, 36, 48, 60, 72].find(
    (m) => monthsBefore(filters.to, m) === filters.from,
  );
  const select = (months: number) => {
    onChange({ from: monthsBefore(filters.to, months) });
    setOpen(false);
  };
  const date = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <section
      aria-label="Activity filters"
      className="grid items-start gap-3 lg:grid-cols-2"
    >
      <div className="space-y-3">
        <div
          role="group"
          aria-label="Date range"
          className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
        >
          {[1, 2].map((weeks) => (
            <Button
              key={`week-${weeks}`}
              aria-label={`${weeks} week${weeks === 1 ? "" : "s"}`}
              aria-pressed={filters.from === weekFrom(weeks)}
              variant={filters.from === weekFrom(weeks) ? "outline" : "ghost"}
              onClick={() => {
                onChange({ from: weekFrom(weeks) });
                setOpen(false);
              }}
            >
              {weeks}W
            </Button>
          ))}
          {[1, 3, 6, 12].map((m) => (
            <Button
              key={m}
              aria-label={rangeLabel(m)}
              aria-pressed={active === m}
              variant={active === m ? "outline" : "ghost"}
              onClick={() => select(m)}
            >
              {m === 12 ? "1Y" : `${m}M`}
            </Button>
          ))}
          <Button
            variant={active && active > 12 ? "outline" : "ghost"}
            aria-expanded={open}
            aria-controls="date-options"
            onClick={() => setOpen((value) => !value)}
          >
            {active && active > 12 ? `${active / 12}Y` : "More"}
            <ChevronDown className="size-3" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto max-w-full justify-start px-1 font-normal text-muted-foreground"
            aria-label="Edit custom dates"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <CalendarDays className="size-3.5" />
            <span className="text-xs">
              {date(filters.from)} – {date(filters.to)}
            </span>
          </Button>
        </div>
        {open && (
          <div
            id="date-options"
            className="panel space-y-4 p-4"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Longer periods</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close date options"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[24, 36, 48, 60, 72].map((m) => (
                <Button
                  key={m}
                  variant={active === m ? "default" : "outline"}
                  aria-pressed={active === m}
                  onClick={() => select(m)}
                >
                  {rangeLabel(m)}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t pt-4">
              <div>
                <Label htmlFor="from" className="text-xs text-muted-foreground">
                  From · UTC
                </Label>
                <Input
                  className="mt-1 w-40"
                  id="from"
                  type="date"
                  value={filters.from}
                  max={filters.to}
                  onChange={(e) => {
                    if (e.target.value) onChange({ from: e.target.value });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="to" className="text-xs text-muted-foreground">
                  Through · UTC
                </Label>
                <Input
                  className="mt-1 w-40"
                  id="to"
                  type="date"
                  value={filters.to}
                  min={filters.from}
                  max={daysAgo(0)}
                  onChange={(e) => {
                    if (e.target.value) onChange({ to: e.target.value });
                  }}
                />
              </div>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
      <details
        className="relative min-w-0 lg:justify-self-end lg:w-80"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
          <span>
            {filters.repo === "all"
              ? "All repositories"
              : `${selected.size} repositories selected`}
          </span>
          <ChevronDown className="size-4" />
        </summary>
        <div className="absolute right-0 z-30 mt-2 max-h-96 w-full min-w-56 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted">
            <input
              type="checkbox"
              aria-label="All repositories"
              checked={selected.size === names.length && names.length > 0}
              ref={(node) => {
                if (node)
                  node.indeterminate =
                    selected.size > 0 && selected.size < names.length;
              }}
              onChange={(event) =>
                onChange({ repo: event.target.checked ? "all" : [] })
              }
            />
            All repositories
          </label>
          {groups.map((org) => {
            const repos = names.filter((name) => name.startsWith(`${org}/`));
            const count = repos.filter((name) => selected.has(name)).length;
            return (
              <details key={org} className="border-t">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Organization ${org}`}
                    checked={count === repos.length}
                    ref={(node) => {
                      if (node)
                        node.indeterminate = count > 0 && count < repos.length;
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggle(repos, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate">{org}</span>
                  <ChevronDown className="size-3" />
                </summary>
                <div className="pb-2 pl-4">
                  {repos.map((name) => (
                    <label
                      key={name}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        aria-label={name}
                        checked={selected.has(name)}
                        onChange={(event) =>
                          toggle([name], event.target.checked)
                        }
                      />
                      <span className="truncate">
                        {name.slice(org.length + 1)}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </details>
    </section>
  );
}

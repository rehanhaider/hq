import { useState } from "react";
import { ChevronDown, SlidersHorizontal, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { monthsBefore, rangeLabel } from "@/lib/activity";
import { daysAgo } from "@/lib/model";
import type { Filters, Repository } from "@/lib/model";
export function ActivityFilters({
  filters,
  repositories,
  onChange,
}: {
  filters: Filters;
  repositories: Repository[];
  onChange: (patch: Partial<Filters>) => void;
}) {
  const [panel, setPanel] = useState<"dates" | "projects" | null>(null);
  const weekFrom = (weeks: number) =>
    new Date(Date.parse(`${filters.to}T00:00:00Z`) - (weeks * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const active = [1, 3, 6, 12, 24, 36, 48, 60, 72].find(
    (m) => monthsBefore(filters.to, m) === filters.from,
  );
  const select = (months: number) => {
    onChange({ from: monthsBefore(filters.to, months) });
    setPanel(null);
  };
  const date = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <section aria-label="Activity filters" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Date range"
          className="flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
        >
          {[1, 2].map((weeks) => (
            <Button
              key={`week-${weeks}`}
              aria-label={`${weeks} week${weeks === 1 ? "" : "s"}`}
              aria-pressed={filters.from === weekFrom(weeks)}
              variant={filters.from === weekFrom(weeks) ? "outline" : "ghost"}
              onClick={() => {
                onChange({ from: weekFrom(weeks) });
                setPanel(null);
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
            aria-expanded={panel === "dates"}
            aria-controls="date-options"
            onClick={() => setPanel(panel === "dates" ? null : "dates")}
          >
            {active && active > 12 ? `${active / 12}Y` : "More"}
            <ChevronDown className="size-3" />
          </Button>
        </div>
        <Button
          variant="ghost"
          className="min-w-0 max-w-full text-muted-foreground"
          aria-expanded={panel === "projects"}
          aria-controls="project-options"
          onClick={() => setPanel(panel === "projects" ? null : "projects")}
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="truncate">
            {filters.repo === "all" ? "All projects" : filters.repo}
          </span>
          <ChevronDown className="size-3" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto max-w-full justify-start px-1 font-normal text-muted-foreground"
        aria-label="Edit custom dates"
        aria-expanded={panel === "dates"}
        onClick={() => setPanel(panel === "dates" ? null : "dates")}
      >
        <CalendarDays className="size-3.5" />
        <span className="text-xs">
          {date(filters.from)} – {date(filters.to)}
        </span>
      </Button>
      {panel === "dates" && (
        <div
          id="date-options"
          className="panel space-y-4 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPanel(null);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Longer periods</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close date options"
              onClick={() => setPanel(null)}
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
            <Button variant="outline" onClick={() => setPanel(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {panel === "projects" && (
        <div
          id="project-options"
          className="panel flex flex-wrap items-end gap-3 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPanel(null);
          }}
        >
          <div className="min-w-0 flex-1">
            <Label
              htmlFor="project-filter"
              className="text-xs text-muted-foreground"
            >
              Filter by project
            </Label>
            <select
              id="project-filter"
              className="field mt-1 w-full"
              value={filters.repo}
              onChange={(e) => {
                onChange({ repo: e.target.value });
                setPanel(null);
              }}
            >
              <option value="all">All projects</option>
              {repositories.map((r) => (
                <option key={r.id} value={r.fullName}>
                  {r.fullName}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              onChange({ repo: "all" });
              setPanel(null);
            }}
          >
            Reset
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close project filter"
            onClick={() => setPanel(null)}
          >
            <X />
          </Button>
        </div>
      )}
    </section>
  );
}

import { Chart } from "@tanstack/charts/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { dailyActivity } from "@/lib/activity";
import {
  activityChart,
  activityReadout,
  metricLabels,
  type ActivityRow,
} from "@/lib/charts";
import type { summarize } from "@/lib/metrics";
import type { Filters } from "@/lib/model";
export function ActivityChart({
  daily,
  from,
  to,
  projects,
  metric,
  chart,
  onChange,
  onSelect,
}: {
  daily: ReturnType<typeof summarize>["daily"];
  from: string;
  to: string;
  projects: { since: string; until: string }[];
  metric: Filters["metric"];
  chart: Filters["chart"];
  onChange: (patch: Partial<Filters>) => void;
  /** Drill into a day. Absent, days highlight but do nothing. */
  onSelect?: (from: string, to: string) => void;
}) {
  const [active, setActive] = useState<ActivityRow | null>(null);
  const definition = useMemo(
    () => activityChart(dailyActivity(daily, from, to, projects), metric, chart),
    [daily, from, to, projects, metric, chart],
  );
  return (
    <section className="card min-w-0 p-5" aria-label="Activity">
      <h2 className="section-title">Activity</h2>
      <div className="my-3 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Chart metric"
          className="flex flex-wrap gap-1"
        >
          {Object.entries(metricLabels).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              className="w-28"
              variant={metric === key ? "default" : "outline"}
              aria-pressed={metric === key}
              onClick={() => onChange({ metric: key as Filters["metric"] })}
            >
              {label}
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Chart view"
          className="ml-auto flex gap-1"
        >
          {(["daily", "cumulative"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              className="w-28"
              variant={chart === mode ? "default" : "outline"}
              aria-pressed={chart === mode}
              onClick={() => onChange({ chart: mode })}
            >
              {mode === "daily" ? "Daily" : "Cumulative"}
            </Button>
          ))}
        </div>
      </div>
      <Chart
        definition={definition}
        height={240}
        initialWidth={840}
        className="mt-4"
        ariaLabel={`${metricLabels[metric]}: ${chart === "daily" ? "daily bars" : "cumulative line"}, ${from} to ${to}`}
        onFocusChange={(point) => setActive(point?.datum ?? null)}
        onSelect={
          onSelect
            ? (point) => point && onSelect(point.datum.from, point.datum.to)
            : undefined
        }
      />
      <p aria-live="polite" className="sr-only">
        {active ? activityReadout(active, metric) : ""}
      </p>
    </section>
  );
}

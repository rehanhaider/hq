import { Button } from "@/components/ui/button";
import { useState } from "react";
import { dailyActivity, activityValues } from "@/lib/activity";
import type { summarize } from "@/lib/metrics";
import type { Filters } from "@/lib/model";
const labels = {
  commits: "Commits",
  prs: "Your PRs merged",
  mergedPrs: "PRs merged by you",
  lines: "Line changes",
};
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
  onSelect: (from: string, to: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const rows = dailyActivity(daily, from, to, projects);
  const values = activityValues(rows, metric, chart);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const x = (i: number) => 30 + ((i + 0.5) * 840) / rows.length;
  const y = (v: number) => 190 - (v / max) * 165;
  let path = "";
  values.forEach((v, i) => {
    if (v !== null)
      path += `${i === 0 || values[i - 1] === null ? "M" : "L"}${x(i)},${y(v)} `;
  });
  const selected = active === null ? undefined : rows[active];
  return (
    <section className="panel min-w-0 p-5" aria-label="Activity over time">
      <h2 className="font-semibold">Activity over time</h2>
      <div className="my-3 flex flex-wrap items-start justify-between gap-3">
        <div
          role="group"
          aria-label="Chart metric"
          className="flex flex-wrap gap-1"
        >
          {Object.entries(labels).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
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
              variant={chart === mode ? "default" : "outline"}
              aria-pressed={chart === mode}
              onClick={() => onChange({ chart: mode })}
            >
              {mode === "daily" ? "Daily" : "Cumulative"}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {chart === "daily"
          ? "Daily totals in UTC. Today may be partial."
          : "Running total of imported activity within the selected dates."}{" "}
        Line changes count additions + deletions.
      </p>
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 900 220"
          className="mt-4 w-full"
          role="img"
          aria-label={`${labels[metric]}: ${chart === "daily" ? "daily bars" : "cumulative line"}`}
        >
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line
                x1="30"
                x2="870"
                y1={y(n * max)}
                y2={y(n * max)}
                className="stroke-border"
              />
              <text
                x="0"
                y={y(n * max) - 3}
                fontSize="10"
                className="fill-muted-foreground hidden sm:block"
              >
                {Math.round(n * max).toLocaleString()}
              </text>
            </g>
          ))}
          {chart === "cumulative" && (
            <path
              d={path}
              fill="none"
              className="stroke-primary"
              strokeWidth="3"
            />
          )}
          {rows.map((row, i) => (
            <g key={row.day}>
              {values[i] !== null &&
                (chart === "daily" ? (
                  <rect
                    x={x(i) - Math.min(30, 350 / rows.length)}
                    y={y(values[i]!)}
                    width={Math.min(60, 700 / rows.length)}
                    height={Math.max(1, 190 - y(values[i]!))}
                    className="fill-primary"
                    opacity={row.coverage === "partial" ? 0.55 : 0.85}
                  />
                ) : (
                  <circle
                    cx={x(i)}
                    cy={y(values[i]!)}
                    r={rows.length > 90 ? 0 : 3}
                    className="fill-primary"
                  />
                ))}
              <rect
                x={x(i) - 420 / rows.length}
                y="15"
                width={840 / rows.length}
                height="180"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${row.day}: ${values[i] === null ? "Not imported" : `${values[i]} ${labels[metric]}`} (${row.coverage} coverage). View records.`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => onSelect(row.from, row.to)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(row.from, row.to);
                  }
                }}
              >
                <title>
                  {`${row.day}: ${values[i] ?? "Not imported"} · ${row.coverage} coverage`}
                </title>
              </rect>
              {(rows.length <= 12 ||
                (i % Math.ceil(rows.length / 8) === 0 &&
                  i < rows.length - Math.ceil(rows.length / 16)) ||
                i === rows.length - 1) && (
                <text
                  x={x(i)}
                  y="212"
                  textAnchor="middle"
                  fontSize="10"
                  className="fill-muted-foreground hidden sm:block"
                >
                  {row.day}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground sm:hidden">
        <span>{from}</span>
        <span>{to}</span>
      </div>
      <p
        aria-live="polite"
        className="mt-2 min-h-8 text-xs text-muted-foreground"
      >
        {selected
          ? `${selected.day}: ${values[active!] === null ? "Not imported" : `${values[active!]!.toLocaleString()} ${labels[metric]}`} · ${selected.coverage} coverage`
          : "Select a day to see its records. Gaps mean history has not been imported; faded bars indicate partial coverage."}
      </p>
    </section>
  );
}

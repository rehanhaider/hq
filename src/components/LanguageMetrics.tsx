import { Button } from "@/components/ui/button";
import type { summarize } from "@/lib/metrics";
export function LanguageMetrics({
  data,
  mode,
  onModeChange,
}: {
  data: ReturnType<typeof summarize>;
  mode: "pie" | "table";
  onModeChange: (mode: "pie" | "table") => void;
}) {
  const total = data.languages.reduce(
    (n, r) => n + r.additions + r.deletions,
    0,
  );
  const positive = data.languages.filter((r) => r.additions + r.deletions > 0);
  const slices = positive
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      additions: r.additions,
      deletions: r.deletions,
    }));
  if (positive.length > 5)
    slices.push({
      name: `Remaining ${positive.length - 5} file types`,
      additions: positive.slice(5).reduce((n, r) => n + r.additions, 0),
      deletions: positive.slice(5).reduce((n, r) => n + r.deletions, 0),
    });
  let offset = 0;
  const gradient = slices
    .map((r, i) => {
      const start = offset;
      offset += ((r.additions + r.deletions) / total) * 100;
      return `var(--chart-${i + 1}) ${start}% ${offset}%`;
    })
    .join(", ");
  return (
    <section className="panel min-w-0 p-5" aria-label="Language metrics">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Languages</h2>
        <div
          role="group"
          aria-label="Language view"
          className="flex gap-1 rounded-lg bg-muted/60 p-1"
        >
          {(["pie", "table"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "outline" : "ghost"}
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
            >
              {value === "pie" ? "Pie" : "Table"}
            </Button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Share of lines added + deleted. Includes documentation, configuration,
        and lockfiles.
      </p>
      {(data.breakdown.Unclassified.additions > 0 ||
        data.breakdown.Unclassified.deletions > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Unclassified lines preserve GitHub commit totals where file details
          are incomplete or inconsistent. Their language and category are
          unknown.
        </p>
      )}
      {data.missingLanguageCommits > 0 && (
        <p role="status" className="mt-3 text-sm">
          Refresh imports to collect language details for{" "}
          {data.missingLanguageCommits} commits. These commits are excluded from
          this view.
        </p>
      )}
      {mode === "pie" ? (
        total > 0 ? (
          <div className="mt-6 grid items-center gap-8 md:grid-cols-[minmax(180px,280px)_minmax(0,1fr)]">
            <div
              className="relative mx-auto aspect-square w-full max-w-64 rounded-full"
              style={{ background: `conic-gradient(${gradient})` }}
              role="img"
              aria-label={`Language distribution: ${slices.map((r) => `${r.name} ${(((r.additions + r.deletions) / total) * 100).toFixed(1)}%`).join(", ")}`}
            >
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-card text-center">
                <span className="font-mono text-xl font-medium">
                  {total.toLocaleString("en-US")}
                </span>
                <span className="mt-1 text-[11px] text-muted-foreground">
                  lines changed
                </span>
              </div>
            </div>
            <div>
              <ul className="space-y-4" aria-label="Language chart legend">
                {slices.map((r, i) => (
                  <li key={r.name} className="flex items-center gap-3">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: `var(--chart-${i + 1})` }}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm">{r.name}</span>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        +{r.additions.toLocaleString("en-US")} / −
                        {r.deletions.toLocaleString("en-US")}
                      </div>
                    </div>
                    <span className="font-mono text-sm">
                      {(((r.additions + r.deletions) / total) * 100).toFixed(1)}
                      %
                    </span>
                  </li>
                ))}
              </ul>
              {positive.length > 5 && (
                <p className="mt-5 text-xs text-muted-foreground">
                  Top five file types shown individually. Open Table for the
                  full breakdown.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            No line changes with language details in this period.
          </p>
        )
      ) : data.languages.length ? (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-3 text-xs text-muted-foreground">
            A commit touching multiple languages counts once in each.
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {[
                  "Language / file type",
                  "Added",
                  "Deleted",
                  "Commits",
                  "Projects",
                  "Share of changes",
                ].map((t) => (
                  <th key={t} className="whitespace-nowrap p-2">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.languages.map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 font-mono text-positive">
                    +{r.additions.toLocaleString()}
                  </td>
                  <td className="p-2 font-mono text-negative">
                    −{r.deletions.toLocaleString()}
                  </td>
                  <td className="p-2 font-mono">{r.commits}</td>
                  <td className="p-2 font-mono">{r.projects}</td>
                  <td className="p-2 font-mono">
                    {total
                      ? (((r.additions + r.deletions) / total) * 100).toFixed(1)
                      : "0"}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No language details for this period.
        </p>
      )}
    </section>
  );
}

import { Button } from "@/components/ui/button";
import { groupLanguages, type summarize } from "@/lib/metrics";

function share(part: number, total: number) {
  return total ? (part / total) * 100 : 0;
}

function shareLabel(part: number, total: number) {
  return `${share(part, total).toFixed(1)}%`;
}

function sliceColor(index: number, rest: boolean) {
  if (rest) return "var(--chart-6)";
  return `var(--chart-${(index % 5) + 1})`;
}

function ShareBar({
  pct,
  color,
  className,
}: {
  pct: number;
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={`h-2 w-full min-w-0 rounded-full bg-foreground/12 ${className ?? ""}`}
    >
      <div
        className="h-full rounded-full bg-primary/70"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          ...(color ? { background: color } : {}),
        }}
      />
    </div>
  );
}

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
  const slices = groupLanguages(data.languages);
  const leftover = slices.some((row) => row.remaining) ? 1 : 0;
  let offset = 0;
  const gradient = slices
    .map((r, i) => {
      const start = offset;
      offset += share(r.additions + r.deletions, total);
      return `${sliceColor(i, leftover > 0 && i === slices.length - 1)} ${start}% ${offset}%`;
    })
    .join(", ");
  return (
    <section className="section min-w-0 pt-6" aria-label="Language metrics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Languages</h2>
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
      {mode === "pie" ? (
        total > 0 ? (
          <div className="mt-5 grid items-center gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
            <div
              className="relative mx-auto aspect-square w-full max-w-64 rounded-full sm:max-w-72"
              style={{ background: `conic-gradient(${gradient})` }}
              role="img"
              aria-label={`Language distribution: ${slices.map((r) => `${r.name} ${shareLabel(r.additions + r.deletions, total)}`).join(", ")}`}
            >
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-background text-center">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {total.toLocaleString("en-US")}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  lines changed
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <ul className="space-y-3" aria-label="Language chart legend">
                {slices.map((r, i) => {
                  const pct = share(r.additions + r.deletions, total);
                  const color = sliceColor(
                    i,
                    leftover > 0 && i === slices.length - 1,
                  );
                  return (
                    <li
                      key={r.name}
                      className="group grid grid-cols-[0.625rem_minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[0.625rem_minmax(6rem,10rem)_minmax(0,1fr)_3.25rem]"
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="min-w-0 truncate text-sm">{r.name}</span>
                      <span className="relative hidden min-w-0 sm:block">
                        <ShareBar pct={pct} color={color} />
                        <span
                          aria-hidden
                          className="absolute -inset-y-2 right-0 flex translate-x-2 items-center gap-3 bg-background pl-3 text-xs tabular-nums opacity-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none group-hover:translate-x-0 group-hover:opacity-100"
                        >
                          <span className="text-positive">
                            +{r.additions.toLocaleString("en-US")}
                          </span>
                          <span className="text-negative">
                            −{r.deletions.toLocaleString("en-US")}
                          </span>
                        </span>
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {pct.toFixed(1)}%
                      </span>
                      <span className="col-start-2 flex gap-3 text-xs tabular-nums sm:hidden">
                        <span className="text-positive">
                          +{r.additions.toLocaleString("en-US")}
                        </span>
                        <span className="text-negative">
                          −{r.deletions.toLocaleString("en-US")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            No line changes with language details in this period.
          </p>
        )
      ) : data.languages.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-normal">Language / file type</th>
                <th className="w-full py-2 pr-4 font-normal">Share</th>
                <th className="py-2 pr-4 text-right font-normal">Added</th>
                <th className="py-2 pr-4 text-right font-normal">Deleted</th>
                <th className="py-2 pr-4 text-right font-normal">Commits</th>
                <th className="py-2 text-right font-normal">Repositories</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((r) => {
                const pct = share(r.additions + r.deletions, total);
                return (
                  <tr key={r.name} className="border-t">
                    <td className="whitespace-nowrap py-2.5 pr-4">{r.name}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-3">
                        <ShareBar pct={pct} />
                        <span className="w-12 shrink-0 text-right tabular-nums">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="w-[1%] whitespace-nowrap py-2.5 pr-4 text-right tabular-nums text-positive">
                      +{r.additions.toLocaleString()}
                    </td>
                    <td className="w-[1%] whitespace-nowrap py-2.5 pr-4 text-right tabular-nums text-negative">
                      −{r.deletions.toLocaleString()}
                    </td>
                    <td className="w-[1%] whitespace-nowrap py-2.5 pr-4 text-right tabular-nums">
                      {r.commits ?? "—"}
                    </td>
                    <td className="w-[1%] whitespace-nowrap py-2.5 text-right tabular-nums">
                      {r.projects ?? "—"}
                    </td>
                  </tr>
                );
              })}
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

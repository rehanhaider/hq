import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  FolderGit2,
  RefreshCw,
} from "lucide-react";
import { Route } from "@/routes/github";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LanguageMetrics } from "./LanguageMetrics";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityChart } from "./ActivityChart";
import { Connections } from "./Connections";
import { OpenWork } from "./OpenWork";
import { GithubOverview } from "./GithubOverview";
import { dashboardQuery, statusQuery } from "@/queries/dashboard";
import { categories } from "@/lib/model";
import { utcDay, utcStamp } from "@/lib/activity";
import { cn } from "@/lib/utils";
import type { Filters } from "@/lib/model";
import type { getDashboard } from "@/server/fns";

type Data = Awaited<ReturnType<typeof getDashboard>>;
const number = (n: number) => n.toLocaleString("en-US");
export function Dashboard() {
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const dashboard = useQuery({
    ...dashboardQuery(filters),
    enabled:
      filters.view !== "connections" &&
      filters.view !== "projects" &&
      filters.view !== "work",
  });
  const status = useQuery(statusQuery);
  const data = dashboard.data;
  useEffect(() => {
    if (filters.view !== "connections") return;
    void navigate({
      search: (previous) => ({ ...previous, view: "projects" }),
      replace: true,
    });
  }, [filters.view, navigate]);
  const setFilters = (patch: Partial<Filters>) => {
    void navigate({
      search: (previous) => ({ ...previous, page: 1, ...patch }),
      resetScroll: false,
    });
  };
  const importing = status.data?.state === "running";
  const hasData = Boolean(data?.repositories.length);
  return (
    <div className="space-y-5">
      {status.data &&
        status.data.state !== "idle" &&
        status.data.state !== "complete" && (
          <div
            className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-xs ${status.data.state === "error" ? "border-negative/30 bg-negative/5" : "bg-card"}`}
            role={status.data.state === "error" ? "alert" : "status"}
          >
            {importing ? (
              <RefreshCw className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : status.data.state === "error" ? (
              <CircleAlert className="size-4 shrink-0 text-negative" />
            ) : (
              <Check className="size-4 shrink-0 text-positive" />
            )}
            <span className="min-w-0 flex-1 break-words">
              {status.data.message}
            </span>
            <span className="font-mono text-muted-foreground">
              {status.data.completed}/{status.data.total}
            </span>
            {importing && (
              <Progress
                aria-label="Repositories imported"
                value={
                  status.data.total
                    ? (status.data.completed / status.data.total) * 100
                    : 0
                }
                className="w-24"
              />
            )}
          </div>
        )}

      {filters.view === "connections" || filters.view === "projects" ? (
        <Connections importing={importing} />
      ) : filters.view === "work" ? (
        <OpenWork />
      ) : filters.view === "overview" ? (
        <GithubOverview filters={filters} />
      ) : (
        <>
          <ActivityFilters
            filters={filters}
            repositories={data?.repositories ?? []}
            onChange={setFilters}
          />
          {filters.from > filters.to ? (
            <p role="alert" className="text-negative">
              The start date must be before the end date.
            </p>
          ) : dashboard.isPending ? (
            <div
              className="grid grid-cols-2 gap-4 lg:grid-cols-4"
              aria-label="Loading activity"
            >
              {[0, 1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-32 animate-pulse rounded-xl bg-muted"
                />
              ))}
            </div>
          ) : dashboard.error ? (
            <div className="card p-5">
              <p role="alert">{dashboard.error.message}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => void dashboard.refetch()}
              >
                Reload data
              </Button>
            </div>
          ) : (
            data && (
              <>
                {!hasData ? (
                  <div className="section flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center">
                    <span className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-muted">
                      <FolderGit2 className="size-5 text-muted-foreground" />
                    </span>
                    <h2 className="font-semibold">Your activity starts here</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                      Connect repositories once. New commits land on their own
                      after that.
                    </p>
                    <Link
                      to="/github"
                      search={{ ...filters, view: "projects" }}
                      className={cn(buttonVariants({ size: "lg" }), "mt-5")}
                    >
                      Open repositories
                    </Link>
                  </div>
                ) : (
                  <Statistics
                    data={data}
                    filters={filters}
                    setFilters={setFilters}
                  />
                )}
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="min-w-0">
      <span className="section-label">{label}</span>
      <p
        className={`mt-1.5 text-2xl font-semibold tracking-tight tabular-nums ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : ""}`}
      >
        {tone === "positive" ? "+" : tone === "negative" ? "−" : ""}
        {number(value)}
      </p>
    </div>
  );
}

function Statistics({
  data,
  filters,
  setFilters,
}: {
  data: Data;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
}) {
  const changes = data.total.additions + data.total.deletions;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="display">{number(data.total.commits)}</span>
            <span className="text-base font-normal text-muted-foreground">commits</span>
          </p>
          <p className="mt-2.5 text-sm text-muted-foreground">
            {data.activeDays} active {data.activeDays === 1 ? "day" : "days"}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
          <Metric label="PRs merged" value={data.total.authoredPrs} />
          <Metric
            label="Lines added"
            value={data.total.additions}
            tone="positive"
          />
          <Metric
            label="Lines deleted"
            value={data.total.deletions}
            tone="negative"
          />
        </div>
      </div>
      <div className="section grid min-w-0 gap-6 pt-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:gap-8">
        <ActivityChart
          projects={data.projects}
          metric={filters.metric}
          chart={filters.chart}
          onChange={setFilters}
          daily={data.daily}
          from={filters.from}
          to={filters.to}
        />
        <section className="min-w-0">
          <h2 className="section-title">Code composition</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Share of additions + deletions
          </p>
          <div className="mt-5 space-y-4">
            {categories.map((category) => {
              const value = data.breakdown[category];
              const count = value.additions + value.deletions;
              const pct = changes ? Math.round((count / changes) * 100) : 0;
              return (
                <div key={category}>
                  <div className="mb-1.5 flex items-baseline gap-2 text-xs">
                    <span>{category}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <LanguageMetrics
        data={data}
        mode={filters.languages}
        onModeChange={(languages) => setFilters({ languages })}
      />
      <div className="section grid min-w-0 gap-8 pt-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:gap-10">
        <Projects
          data={data}
          limit={5}
          onSelect={(repo) => setFilters({ repo })}
          onAll={() => setFilters({ view: "projects" })}
        />
        <section className="flex min-w-0 flex-col">
          <h2 className="section-title">Delivery</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your merged pull requests
          </p>
          <div className="mt-5">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {data.medianHours === null
                ? "—"
                : data.medianHours >= 24
                  ? `${(data.medianHours / 24).toFixed(1)}d`
                  : `${data.medianHours.toFixed(1)}h`}
            </span>
            <p className="mt-2 text-xs text-muted-foreground">
              Median time from opening to merge
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function Projects({
  data,
  onSelect,
  onAll,
  limit,
}: {
  data: Data;
  onSelect: (repo: string) => void;
  onAll?: () => void;
  limit?: number;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Most active</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ordered by your commit count
          </p>
        </div>
        {onAll && (
          <Button variant="ghost" size="sm" onClick={onAll}>
            View all <ArrowUpRight />
          </Button>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-y text-muted-foreground">
            <tr>
              <th className="py-2.5 pr-4 font-normal">Repository</th>
              <th className="py-2.5 pl-4 text-right font-normal">Commits</th>
              <th className="py-2.5 pl-4 text-right font-normal">
                PRs merged
              </th>
              <th className="py-2.5 pl-4 text-right font-normal">
                Lines + / −
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.projects
              .slice(0, limit ?? data.projects.length)
              .map((project) => (
                <tr key={project.id} className="hover:bg-muted/30">
                  <td className="py-3 pr-4">
                    <button
                      className="flex items-center gap-2 text-left font-medium hover:text-primary"
                      onClick={() => onSelect(project.fullName)}
                    >
                      <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                      <span>{project.fullName}</span>
                    </button>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                      {project.language ?? "Unclassified"} ·{" "}
                      {project.private ? "Private" : "Public"}
                    </p>
                    {!limit && (
                      <p className="mt-2 max-w-80 pl-6 text-xs leading-relaxed text-muted-foreground">
                        History {utcDay(project.since)} through{" "}
                        {utcStamp(project.until)} UTC
                        {project.importedAt
                          ? ` · Fetched ${utcStamp(project.importedAt)} UTC`
                          : ""}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pl-4 text-right tabular-nums">
                    {number(project.commits)}
                  </td>
                  <td className="py-3 pl-4 text-right tabular-nums">
                    {number(project.authoredPrs)}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-4 text-right tabular-nums">
                    <span className="text-positive">
                      +{number(project.additions)}
                    </span>
                    <span className="ml-3 text-negative">
                      −{number(project.deletions)}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!data.projects.length && (
          <p className="py-6 text-muted-foreground">
            No imported repository matches this filter.
          </p>
        )}
      </div>
    </section>
  );
}

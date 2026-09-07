import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  FolderGit2,
  GitCommitHorizontal,
  GitMerge,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Route } from "@/routes/github";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { LanguageMetrics } from "./LanguageMetrics";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityChart } from "./ActivityChart";
import { Connections } from "./Connections";
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
    enabled: filters.view !== "connections" && filters.view !== "projects",
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
  const title =
    filters.view === "overview"
      ? "Activity overview"
      : filters.view === "projects" || filters.view === "connections"
        ? "Repositories"
        : "Activity history";

  return (
    <div className="space-y-5">
      <nav aria-label="GitHub views" className="section-tabs">
        {[
          { view: "overview" as const, label: "Overview" },
          { view: "history" as const, label: "Activity history" },
          { view: "projects" as const, label: "Repositories" },
        ].map(({ view, label }) => (
          <Link
            key={view}
            to="/github"
            search={{ ...filters, view, page: 1 }}
            aria-current={
              filters.view === view ||
              (view === "projects" && filters.view === "connections")
                ? "page"
                : undefined
            }
            className="section-tab"
          >
            {label}
          </Link>
        ))}
      </nav>
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
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            </div>
          </div>

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
            <div className="panel p-5">
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
                  <div className="panel flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
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
                ) : filters.view === "overview" ? (
                  <Overview
                    data={data}
                    filters={filters}
                    setFilters={setFilters}
                  />
                ) : (
                  <HistoryList
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
  icon: Icon,
  note,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  note?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="min-w-0 border-l-2 border-border py-1 pl-4 sm:pl-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p
        className={`mt-4 font-mono text-base font-medium tracking-tight sm:text-2xl xl:text-3xl ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : ""}`}
      >
        {tone === "positive" ? "+" : tone === "negative" ? "−" : ""}
        {number(value)}
      </p>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Overview({
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Commits"
          value={data.total.commits}
          icon={GitCommitHorizontal}
          note={`${data.activeDays} active ${data.activeDays === 1 ? "day" : "days"}`}
        />
        <Metric
          label="Your requests merged"
          value={data.total.authoredPrs}
          icon={GitMerge}
        />
        <Metric
          label="Lines added"
          value={data.total.additions}
          icon={Plus}
          tone="positive"
        />
        <Metric
          label="Lines deleted"
          value={data.total.deletions}
          icon={Code2}
          tone="negative"
        />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
        <ActivityChart
          projects={data.projects}
          metric={filters.metric}
          chart={filters.chart}
          onChange={setFilters}
          daily={data.daily}
          from={filters.from}
          to={filters.to}
          onSelect={(from, to) =>
            setFilters({
              from,
              to,
              view: "history",
              kind: filters.metric === "prs" ? "pr" : "commit",
            })
          }
        />
        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Code composition</h2>
            <Code2 className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Share of additions + deletions
          </p>
          <div className="mt-6 space-y-4">
            {categories.map((category) => {
              const value = data.breakdown[category];
              const count = value.additions + value.deletions;
              const pct = changes ? Math.round((count / changes) * 100) : 0;
              return (
                <div key={category}>
                  <div className="mb-1.5 flex items-baseline gap-2 text-xs">
                    <span>{category}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
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
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
        <Projects
          data={data}
          limit={5}
          onSelect={(repo) => setFilters({ repo })}
          onAll={() => setFilters({ view: "projects" })}
        />
        <section className="panel flex flex-col p-5">
          <h2 className="font-semibold">Delivery</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your merged pull requests
          </p>
          <div className="mt-6">
            <span className="font-mono text-3xl font-medium">
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
          <Button
            className="mt-auto self-start pt-4"
            variant="link"
            onClick={() => setFilters({ view: "history", kind: "pr" })}
          >
            View merged requests <ArrowRight />
          </Button>
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
    <section className="panel min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-5">
        <div>
          <h2 className="font-semibold">Most active</h2>
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
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-y bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-5 py-2.5 font-normal">Repository</th>
              <th className="px-5 py-2.5 text-right font-normal">Commits</th>
              <th className="px-5 py-2.5 text-right font-normal">
                Your PRs merged
              </th>
              <th className="px-5 py-2.5 text-right font-normal">
                Lines + / −
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.projects
              .slice(0, limit ?? data.projects.length)
              .map((project) => (
                <tr key={project.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
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
                  <td className="px-5 py-3 text-right font-mono tabular-nums">
                    {number(project.commits)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">
                    {number(project.authoredPrs)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums">
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
          <p className="p-5 text-muted-foreground">
            No imported repository matches this filter.
          </p>
        )}
      </div>
    </section>
  );
}

function HistoryList({
  data,
  filters,
  setFilters,
}: {
  data: Data;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
}) {
  const records = data.history.filter(
    (row) => filters.kind === "all" || row.kind === filters.kind,
  );
  const pages = Math.max(1, Math.ceil(records.length / 30));
  const page = Math.min(filters.page, pages);
  const visible = records.slice((page - 1) * 30, page * 30);
  return (
    <section className="panel min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-semibold">Recorded activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {number(records.length)} records · newest first
          </p>
        </div>
        <div>
          <Label htmlFor="kind" className="sr-only">
            Record type
          </Label>
          <select
            id="kind"
            className="field"
            value={filters.kind}
            onChange={(e) =>
              setFilters({ kind: e.target.value as Filters["kind"] })
            }
          >
            <option value="all">All activity</option>
            <option value="commit">Commits</option>
            <option value="pr">Merged pull requests</option>
          </select>
        </div>
      </div>
      <ul className="divide-y border-t">
        {visible.map((row) => (
          <li
            key={`${row.repo}-${row.id}`}
            className="flex items-start gap-3 px-4 py-4 sm:px-5"
          >
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted ${row.kind === "pr" ? "text-primary" : "text-muted-foreground"}`}
            >
              {row.kind === "pr" ? (
                <GitMerge className="size-3.5" />
              ) : (
                <GitCommitHorizontal className="size-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <a
                className="group flex items-start gap-1 text-sm font-medium hover:text-primary"
                href={row.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="break-words">{row.title}</span>
                <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              </a>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="break-all">{row.repo}</span>
                <span>{row.detail}</span>
                <time dateTime={row.date}>
                  {row.date.slice(0, 16).replace("T", " ")} UTC
                </time>
              </p>
              <p className="mt-2 flex gap-3 font-mono text-xs sm:hidden">
                <span className="text-positive">+{number(row.additions)}</span>
                <span className="text-negative">−{number(row.deletions)}</span>
              </p>
            </div>
            <div className="hidden shrink-0 gap-3 pt-1 font-mono text-xs sm:flex">
              <span className="text-positive">+{number(row.additions)}</span>
              <span className="text-negative">−{number(row.deletions)}</span>
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <div className="p-10 text-center">
          <BookOpen className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-medium">No activity in this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the dates, repository, or record type.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setFilters({ page: page - 1 })}
          >
            <ChevronLeft />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setFilters({ page: page + 1 })}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>
    </section>
  );
}

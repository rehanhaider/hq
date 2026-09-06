import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
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
  History,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Plus,
  RefreshCw,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Route } from "@/routes/index";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { LanguageMetrics } from "./LanguageMetrics";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityChart } from "./ActivityChart";
import { ImportPanel } from "./ImportPanel";
import { dashboardQuery, statusQuery } from "@/queries/dashboard";
import { useUI } from "@/store/ui";
import { categories } from "@/lib/model";
import type { Filters } from "@/lib/model";
import type { getDashboard } from "@/server/fns";

type Data = Awaited<ReturnType<typeof getDashboard>>;
const number = (n: number) => n.toLocaleString("en-US");
const nav: { view: Filters["view"]; title: string; icon: LucideIcon }[] = [
  { view: "overview", title: "Overview", icon: LayoutDashboard },
  { view: "projects", title: "Projects", icon: FolderGit2 },
  { view: "history", title: "Activity history", icon: History },
];

export function Dashboard() {
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const dashboard = useQuery(dashboardQuery(filters));
  const status = useQuery(statusQuery);
  const data = dashboard.data;
  const [showImport, setShowImport] = useState(
    () => !data?.repositories.length,
  );
  const ui = useUI();
  useEffect(() => {
    ui.hydrate();
  }, [ui.hydrate]);
  useEffect(() => {
    if (status.data)
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [
    status.data?.state,
    status.data?.completed,
    status.data?.finishedAt,
    queryClient,
  ]);
  const setFilters = (patch: Partial<Filters>) => {
    void navigate({
      search: (previous) => ({ ...previous, page: 1, ...patch }),
    });
  };
  const importing = status.data?.state === "running";
  const hasData = Boolean(data?.repositories.length);
  const title =
    filters.view === "overview"
      ? "Activity overview"
      : filters.view === "projects"
        ? "Your projects"
        : "Activity history";
  const lastImported = data?.projects
    .map((p) => p.importedAt)
    .sort()
    .at(-1);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <aside className="border-b bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center gap-3 px-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-mono text-xs font-bold text-primary-foreground">
            hq
          </span>
          <span className="font-semibold tracking-tight">GitHub activity</span>
        </div>
        <div className="hidden px-5 pb-3 pt-5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground lg:block">
          Workspace
        </div>
        <nav
          aria-label="Main navigation"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col"
        >
          {nav.map((item) => (
            <Link
              key={item.view}
              to="/"
              search={{ ...filters, view: item.view, page: 1 }}
              aria-current={filters.view === item.view ? "page" : undefined}
              className={`flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${filters.view === item.view ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}
            >
              <item.icon className="size-4" />
              {item.title}
              {filters.view === item.view && (
                <span className="ml-auto hidden size-1.5 rounded-full bg-primary lg:block" />
              )}
            </Link>
          ))}
        </nav>
        <div className="mx-5 mt-auto hidden border-t py-5 lg:block">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full border bg-background font-mono text-xs">
              {data?.login?.slice(0, 2).toUpperCase() ?? "GH"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">
                {data?.login ? `@${data.login}` : "Your workspace"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Personal activity
              </p>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
            <LockKeyhole className="size-3" />
            Stored on this device
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-12 items-center justify-between border-b px-4 sm:px-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Workspace</span>
            <span className="text-border">/</span>
            <span className="text-foreground">
              {nav.find((n) => n.view === filters.view)?.title}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-positive" />
              Local
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                ui.theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              onClick={ui.toggleTheme}
            >
              {ui.theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        <main
          id="main"
          className="mx-auto max-w-[1440px] space-y-5 px-4 py-6 sm:px-6 lg:py-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Activity className="size-3" />
                GitHub / Personal analytics
              </div>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {filters.view === "overview"
                  ? "Commits, code changes, and the work you shipped."
                  : filters.view === "projects"
                    ? "See where your work is happening across repositories."
                    : "Trace every total back to the original work."}
              </p>
            </div>
            <Button
              size="lg"
              variant={hasData ? "ghost" : "default"}
              onClick={() => setShowImport(!showImport)}
              aria-expanded={showImport}
            >
              <ArrowDownToLine />
              {importing ? "Import settings" : "Import activity"}
            </Button>
          </div>

          {showImport && (
            <ImportPanel
              defaultSince={filters.from}
              imported={data?.repositories.map((r) => r.fullName) ?? []}
              busy={importing}
              onClose={() => setShowImport(false)}
            />
          )}
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
                {hasData && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {lastImported
                        ? `Last imported ${new Date(lastImported).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`
                        : "No import yet"}
                    </span>
                    {dashboard.isFetching && (
                      <RefreshCw className="size-3 animate-spin" />
                    )}
                  </div>
                )}
                {hasData && data.incomplete.length > 0 && (
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Some dates have partial coverage. Totals include imported
                      history only, through the last import. See Projects for
                      date coverage.
                    </span>
                  </p>
                )}
                {!hasData ? (
                  <div className="panel flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
                    <span className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-muted">
                      <FolderGit2 className="size-5 text-muted-foreground" />
                    </span>
                    <h2 className="font-semibold">Your activity starts here</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                      Choose the repositories you work on and import their
                      history. Your real numbers will appear here.
                    </p>
                    <span className="mt-5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Commits · Merged requests · Code changes
                    </span>
                  </div>
                ) : filters.view === "overview" ? (
                  <Overview
                    data={data}
                    filters={filters}
                    setFilters={setFilters}
                  />
                ) : filters.view === "projects" ? (
                  <Projects
                    data={data}
                    onSelect={(repo) => setFilters({ repo, view: "overview" })}
                  />
                ) : (
                  <HistoryList
                    data={data}
                    filters={filters}
                    setFilters={setFilters}
                  />
                )}
                <details className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">
                    How these numbers are counted
                  </summary>
                  <div className="mt-3 grid gap-3 leading-relaxed md:grid-cols-2">
                    <p>
                      Commits are attributed by GitHub to your account on each
                      imported default branch, dated by commit time in UTC.
                      Squashed commits count once; unmerged branch work and
                      local commits are outside this view.
                    </p>
                    <p>
                      Lines added and deleted come from non-merge commits.
                      Repeated edits count each time. Generated files and
                      dependencies remain in totals and have their own category.
                      File categories use path and extension rules.
                    </p>
                    <p>
                      “Your requests merged” counts requests you authored that
                      merged during the selected dates. “Merged by you” counts
                      requests you merged, including other authors. Pull-request
                      line changes are never added to commit totals.
                    </p>
                    <p>
                      Median merge time runs from request creation to merge,
                      including draft time. Active days contain an authored
                      commit or an authored request that merged. These are
                      activity measures, not a code-quality score.
                    </p>
                  </div>
                </details>
              </>
            )
          )}
          <footer className="flex flex-wrap justify-between gap-2 border-t pt-4 font-mono text-[10px] text-muted-foreground">
            <span>HQ · Your work, on your machine</span>
            <span>GitHub data · UTC dates</span>
          </footer>
        </main>
      </div>
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
  note: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p
        className={`mt-4 font-mono text-2xl font-medium tracking-tight xl:text-3xl ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : ""}`}
      >
        {tone === "positive" ? "+" : tone === "negative" ? "−" : ""}
        {number(value)}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
          note={`${data.total.mergedPrs} requests merged by you`}
        />
        <Metric
          label="Lines added"
          value={data.total.additions}
          icon={Plus}
          note="Non-merge commits"
          tone="positive"
        />
        <Metric
          label="Lines deleted"
          value={data.total.deletions}
          icon={Code2}
          note="Non-merge commits"
          tone="negative"
        />
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
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
              kind:
                filters.metric === "prs" || filters.metric === "mergedPrs"
                  ? "pr"
                  : "commit",
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
              return (
                <div key={category}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span>{category}</span>
                    <span className="font-mono text-muted-foreground">
                      {changes ? Math.round((count / changes) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${changes ? (count / changes) * 100 : 0}%`,
                      }}
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
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Projects
          data={data}
          limit={5}
          onSelect={(repo) => setFilters({ repo, view: "projects" })}
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
          <div className="my-5 border-t" />
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              Requests merged by you
            </span>
            <span className="font-mono">{number(data.total.mergedPrs)}</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Includes requests from other authors. Your authored and merged
            counts can overlap.
          </p>
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
          <h2 className="font-semibold">
            {limit ? "Most active projects" : "Repository activity"}
          </h2>
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
              <th className="px-3 py-2.5 text-right font-normal">Commits</th>
              <th className="px-3 py-2.5 text-right font-normal">
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
                      <span className="max-w-72 truncate">
                        {project.fullName}
                      </span>
                    </button>
                    <p className="mt-1 pl-6 text-[10px] text-muted-foreground">
                      {project.language ?? "Unclassified"} ·{" "}
                      {project.private ? "Private" : "Public"}
                    </p>
                    {!limit && (
                      <p className="mt-2 max-w-80 pl-6 text-[10px] leading-relaxed text-muted-foreground">
                        Coverage {project.since.slice(0, 10)} through{" "}
                        {project.until.slice(0, 16).replace("T", " ")} UTC
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    {number(project.commits)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    {number(project.authoredPrs)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-mono">
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
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
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

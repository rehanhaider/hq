import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CircleAlert,
  CircleDot,
  GitPullRequest,
  Inbox,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { openWorkQuery } from "@/queries/dashboard";
import { age, arrangeWork, repoOptions, tabItems } from "@/lib/openWork";
import type { WorkItem, WorkKind, WorkSort, WorkTab } from "@/lib/openWork";
import { cn } from "@/lib/utils";

/** One screenful. 166 rows at once is a wall, not a list. */
const PAGE = 50;
const emptyItems: WorkItem[] = [];
const TABS = [
  {
    value: "assigned",
    label: "Assigned to me",
    empty: "Nothing assigned to you.",
  },
  { value: "reviews", label: "Reviews waiting", empty: "No reviews requested." },
  { value: "authored", label: "Authored", empty: "Nothing open of yours." },
  {
    value: "all",
    label: "All open",
    empty: "Nothing open. Everything the token can see is closed.",
  },
] as const;

/**
 * The GitHub module's Work view: one list at a time. The tab picks the list,
 * the row below narrows it, and the rows are grouped by repository so the eye
 * has somewhere to land.
 */
export function OpenWork() {
  const work = useQuery(openWorkQuery);
  const data = work.data;
  const [tab, setTab] = useState<WorkTab>("assigned");
  const [kind, setKind] = useState<WorkKind>("both");
  const [repo, setRepo] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WorkSort>("recent");
  const [limit, setLimit] = useState(PAGE);
  // A clock, so "Updated 12s ago" is true a minute after it was rendered.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const items = data ? tabItems(data, tab) : emptyItems;
  const repos = useMemo(
    () => repoOptions(items.filter((item) => kind === "both" || item.kind === kind)),
    [items, kind],
  );
  const { total, shown, groups } = useMemo(
    () => arrangeWork(items, { kind, repo, search, sort, limit }),
    [items, kind, repo, search, sort, limit],
  );

  function narrow<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setLimit(PAGE);
    };
  }
  const chooseTab = (value: WorkTab) => {
    setTab(value);
    setRepo("all");
    setLimit(PAGE);
  };

  if (work.isPending)
    return (
      <div className="space-y-4" aria-label="Loading open work">
        <div className="h-10 animate-pulse rounded-xl bg-muted" />
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    );

  const connected = data?.connected ?? false;
  const counts = {
    assigned: data?.me.assigned.length ?? 0,
    reviews: data?.me.reviewRequested.length ?? 0,
    authored: data?.me.authored.length ?? 0,
    all: data?.all.length ?? 0,
  };
  const empty = TABS.find((entry) => entry.value === tab)?.empty ?? "";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Open work"
          className="flex min-w-0 flex-wrap gap-1 rounded-xl border bg-muted/60 p-1"
        >
          {TABS.map((entry) => (
            <button
              key={entry.value}
              role="tab"
              aria-selected={tab === entry.value}
              onClick={() => chooseTab(entry.value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium",
                tab === entry.value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="font-mono text-xs tabular-nums opacity-70">
                {counts[entry.value]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {data ? (
            <span className="text-xs text-muted-foreground">
              Updated {age(data.fetchedAt)} ago
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={work.isFetching}
            onClick={() => void work.refetch()}
          >
            <RefreshCw className={work.isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {work.error || data?.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-xs text-negative"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {work.error?.message ?? data?.error}
          </span>
        </p>
      ) : null}

      {!connected ? (
        <Blank
          title="GitHub is not connected"
          body="Set a GitHub token on the server to see the issues and requests waiting on you."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Kind">
              {(
                [
                  ["issue", "Issues"],
                  ["pr", "PRs"],
                  ["both", "Both"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={kind === value}
                  onClick={() => narrow(setKind)(value)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium",
                    kind === value
                      ? "border-foreground/20 bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="Repository"
              className="field max-w-52 min-w-0"
              value={repo}
              onChange={(event) => narrow(setRepo)(event.target.value)}
            >
              <option value="all">All repositories</option>
              {repos.map((option) => (
                <option key={option.repo} value={option.repo}>
                  {option.repo} ({option.count})
                </option>
              ))}
            </select>
            <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search titles"
                placeholder="Search titles"
                className="field w-full pl-8"
                value={search}
                onChange={(event) => narrow(setSearch)(event.target.value)}
              />
            </div>
            <select
              aria-label="Sort"
              className="field"
              value={sort}
              onChange={(event) => narrow(setSort)(event.target.value as WorkSort)}
            >
              <option value="recent">Recently updated</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>

          <section className="section min-w-0 pt-5">
            <p className="text-xs text-muted-foreground" role="status">
              {total
                ? `Showing ${shown} of ${total} across ${groups.length} ${groups.length === 1 ? "repository" : "repositories"}`
                : ""}
            </p>
            {groups.length ? (
              <>
                <div className="mt-4 space-y-6">
                  {groups.map((group) => (
                    <section key={group.repo} className="min-w-0">
                      <div className="flex items-baseline gap-2 border-b pb-1.5">
                        <h3 className="truncate font-mono text-xs font-medium text-foreground">
                          {group.repo}
                        </h3>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {group.items.length}
                        </span>
                      </div>
                      <ul className="list min-w-0">
                        {group.items.map((item) => (
                          <Row key={item.id} item={item} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {total > limit ? (
                  <div className="mt-6 flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLimit((value) => value + PAGE)}
                    >
                      Show {Math.min(PAGE, total - limit)} more
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {items.length ? "Nothing matches this filter." : empty}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** A row is the whole width: icon, number, title, then the meta, right. */
function Row({ item }: { item: WorkItem }) {
  const more = Math.max(0, item.labels.length - 3);
  return (
    <li className="min-w-0">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group -mx-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-2 hover:bg-muted/60"
      >
        <span className="flex min-w-0 flex-[1_1_100%] items-center gap-2.5 sm:flex-1">
          <Kind item={item} />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            #{item.number}
          </span>
          <span className="min-w-0 flex-1 truncate group-hover:text-primary">
            {item.title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pl-8 text-xs text-muted-foreground sm:pl-0">
          {item.draft ? <Chip>Draft</Chip> : null}
          <span className="hidden items-center gap-1 lg:flex">
            {item.labels.slice(0, 3).map((label) => (
              <Chip key={label.name}>{label.name}</Chip>
            ))}
            {more ? <span className="tabular-nums">+{more}</span> : null}
          </span>
          <span className="hidden max-w-32 truncate sm:inline">
            @{item.author}
          </span>
          <span
            className="w-8 text-right font-mono tabular-nums"
            title={`Updated ${item.updatedAt}`}
          >
            {age(item.updatedAt)}
          </span>
          <ArrowUpRight className="size-3 shrink-0 opacity-60" aria-hidden />
        </span>
      </a>
    </li>
  );
}

/** Labels without their colours: the rainbow was noise, the words are not. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 max-w-28 items-center truncate rounded border px-1.5 text-[0.6875rem] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function Kind({ item }: { item: WorkItem }) {
  const Icon = item.kind === "pr" ? GitPullRequest : CircleDot;
  const what = item.draft
    ? "Draft pull request"
    : item.kind === "pr"
      ? "Pull request"
      : "Issue";
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md bg-muted",
        item.kind === "pr" && !item.draft ? "text-primary" : "text-muted-foreground",
        item.draft && "opacity-60",
      )}
      title={what}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{what}</span>
    </span>
  );
}

function Blank({ title, body }: { title: string; body: string }) {
  return (
    <div className="section flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-muted">
        <Inbox className="size-5 text-muted-foreground" />
      </span>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

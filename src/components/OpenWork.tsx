import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CircleAlert,
  CircleDot,
  GitPullRequest,
  Inbox,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { openWorkQuery } from "@/queries/dashboard";
import {
  age,
  arrangeWork,
  repoOptions,
  splitByKind,
  tabCounts,
  tabItems,
} from "@/lib/openWork";
import type { WorkItem, WorkKind, WorkSort, WorkTab } from "@/lib/openWork";
import { cn } from "@/lib/utils";

/** One screenful, per pane. 166 rows at once is a wall, not a list. */
const PAGE = 50;
const emptyItems: WorkItem[] = [];
const TABS = [
  { value: "mine", label: "Mine" },
  { value: "triage", label: "Needs triage" },
] as const;
/** Which pane has the width to itself, or neither. */
type Pane = "both" | WorkKind;
const PANE_KEY = "hq:work-pane";
const PANES = [
  { kind: "issue", title: "Issues", empty: "No issues" },
  { kind: "pr", title: "Pull requests", empty: "No pull requests" },
] as const;

function readPane(): Pane {
  try {
    const saved = localStorage.getItem(PANE_KEY);
    if (saved === "both" || saved === "issue" || saved === "pr") return saved;
  } catch {
    /* no storage, no memory: the default is fine */
  }
  return "both";
}

/**
 * The GitHub module's Work view: what is mine, and what nobody has taken. The
 * tab picks the list, the row below narrows it, and the list itself is two
 * panes — issues on the left, pull requests on the right — either sharing the
 * width or one of them holding it while the other waits in a rail.
 */
export function OpenWork() {
  const work = useQuery(openWorkQuery);
  const data = work.data;
  const [tab, setTab] = useState<WorkTab>("mine");
  const [repo, setRepo] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WorkSort>("recent");
  const [limits, setLimits] = useState({ issue: PAGE, pr: PAGE });
  const [pane, setPane] = useState<Pane>("both");
  const [restored, setRestored] = useState(false);
  // A clock, so "Updated 12s ago" is true a minute after it was rendered.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPane(readPane());
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      /* nothing to remember it with */
    }
  }, [pane, restored]);

  const items = data ? tabItems(data, tab) : emptyItems;
  // The repository list is counted through every filter but the repository
  // itself, which would only ever leave the one already chosen.
  const repos = useMemo(
    () => repoOptions(items, { repo: "all", search }),
    [items, search],
  );
  const counts = useMemo(
    () => tabCounts(data, { repo, search }),
    [data, repo, search],
  );
  const kinds = useMemo(() => splitByKind(items), [items]);
  // The filters below the tabs read the same for both panes; only how far
  // down each has been read apart.
  const views = useMemo(
    () => ({
      issue: { repo, search, sort, limit: limits.issue },
      pr: { repo, search, sort, limit: limits.pr },
    }),
    [repo, search, sort, limits],
  );

  function narrow<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setLimits({ issue: PAGE, pr: PAGE });
    };
  }
  const chooseTab = (value: WorkTab) => {
    setTab(value);
    setRepo("all");
    setLimits({ issue: PAGE, pr: PAGE });
  };

  if (work.isPending)
    return (
      <div className="space-y-4" aria-label="Loading open work">
        <div className="h-10 animate-pulse rounded-xl bg-muted" />
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    );

  const connected = data?.connected ?? false;
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

          <div className="work-panes" data-pane={pane}>
            {PANES.map((entry) => (
              <Pane
                key={entry.kind}
                kind={entry.kind}
                title={entry.title}
                empty={entry.empty}
                items={kinds[entry.kind]}
                view={views[entry.kind]}
                expanded={pane === entry.kind}
                railed={pane !== "both" && pane !== entry.kind}
                open={(pane === "pr" ? "pr" : "issue") === entry.kind}
                onToggle={() => setPane(pane === entry.kind ? "both" : entry.kind)}
                onMore={() =>
                  setLimits((value) => ({
                    ...value,
                    [entry.kind]: value[entry.kind] + PAGE,
                  }))
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One half of the split: a card of one kind. Wide, it is either half the row,
 * the whole of it, or a rail holding its place; narrow, the two panes are an
 * accordion and this one is open or a single header row.
 */
function Pane({
  kind,
  title,
  empty,
  items,
  view,
  expanded,
  railed,
  open,
  onToggle,
  onMore,
}: {
  kind: WorkKind;
  title: string;
  empty: string;
  items: WorkItem[];
  view: { repo: string; search: string; sort: WorkSort; limit: number };
  expanded: boolean;
  railed: boolean;
  open: boolean;
  onToggle: () => void;
  onMore: () => void;
}) {
  const { total, shown, groups } = useMemo(
    () => arrangeWork(items, view),
    [items, view],
  );
  const Icon = kind === "pr" ? GitPullRequest : CircleDot;
  const Toggle = expanded ? Minimize2 : Maximize2;
  return (
    <section className="card flex min-w-0 flex-col overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/50",
          railed && "lg:hidden",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            kind === "pr" ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span className="section-title truncate">{title}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {total}
        </span>
        <Toggle className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">
          {expanded ? `Collapse ${title}` : `Expand ${title}`}
        </span>
      </button>
      {railed ? (
        <button
          type="button"
          onClick={onToggle}
          className="hidden h-full w-full flex-col items-center gap-3 py-3 hover:bg-muted/50 lg:flex"
        >
          <Icon
            className={cn(
              "size-4 shrink-0",
              kind === "pr" ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {total}
          </span>
          <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
            {title}
          </span>
          <span className="sr-only">Expand {title}</span>
        </button>
      ) : null}
      <div
        className={cn(
          "min-w-0 px-4 pb-4",
          railed ? "hidden" : open ? "block" : "hidden lg:block",
        )}
      >
        {groups.length ? (
          <>
            <div className="space-y-5">
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
            {total > shown ? (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" size="sm" onClick={onMore}>
                  Show {Math.min(PAGE, total - shown)} more
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {items.length ? "Nothing matches this filter." : empty}
          </p>
        )}
      </div>
    </section>
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

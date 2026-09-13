import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowUpRight,
  CircleAlert,
  CircleDot,
  GitPullRequest,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "./DataTable";
import { openWorkQuery } from "@/queries/dashboard";
import { age, labelChip } from "@/lib/openWork";
import type { WorkItem } from "@/lib/openWork";
import { cn } from "@/lib/utils";

const emptyRows: WorkItem[] = [];
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnMeta: {} as { className?: string },
});
const helper = createColumnHelper<typeof features, WorkItem>();
const columns = helper.columns([
  helper.accessor("kind", {
    header: "Kind",
    meta: { className: "w-[1%]" },
    cell: ({ row }) => <Kind item={row.original} />,
  }),
  helper.accessor("repo", {
    header: "Repo",
    meta: { className: "w-[1%] whitespace-nowrap" },
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue()}</span>
    ),
  }),
  helper.accessor("title", {
    header: "Title",
    cell: ({ row }) => <TitleLink item={row.original} />,
  }),
  helper.accessor("author", {
    header: "Author",
    meta: {
      className: "hidden w-[1%] whitespace-nowrap text-muted-foreground sm:table-cell",
    },
    cell: ({ getValue }) => `@${getValue()}`,
  }),
  helper.accessor("updatedAt", {
    id: "age",
    header: "Age",
    meta: { className: "w-[1%] text-right font-mono whitespace-nowrap" },
    cell: ({ row }) => (
      <span title={`Updated ${row.original.updatedAt}`}>
        {age(row.original.updatedAt)}
      </span>
    ),
  }),
  helper.display({
    id: "labels",
    header: "Labels",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => <Labels item={row.original} />,
  }),
]);

function Kind({ item }: { item: WorkItem }) {
  const Icon = item.kind === "pr" ? GitPullRequest : CircleDot;
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-md bg-muted",
        item.kind === "pr" ? "text-primary" : "text-muted-foreground",
        item.draft && "text-muted-foreground",
      )}
      title={item.draft ? "Draft pull request" : item.kind === "pr" ? "Pull request" : "Issue"}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">
        {item.draft ? "Draft pull request" : item.kind === "pr" ? "Pull request" : "Issue"}
      </span>
    </span>
  );
}

function TitleLink({ item }: { item: WorkItem }) {
  return (
    <a
      className="group flex items-start gap-1 font-medium hover:text-primary"
      href={item.url}
      target="_blank"
      rel="noreferrer"
    >
      <span className="break-words">
        <span className="font-mono text-muted-foreground">#{item.number}</span>{" "}
        {item.title}
        {item.draft ? (
          <span className="ml-2 text-xs text-muted-foreground">Draft</span>
        ) : null}
      </span>
      <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}

function Labels({ item }: { item: WorkItem }) {
  if (!item.labels.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {item.labels.slice(0, 4).map((label) => (
        <span
          key={label.name}
          className="inline-flex h-[1.125rem] max-w-36 items-center truncate rounded-sm px-1.5 text-[0.6875rem] font-medium"
          style={labelChip(label.color)}
        >
          {label.name}
        </span>
      ))}
    </span>
  );
}

/** The GitHub module's Work view: what is open, everywhere the token reaches. */
export function OpenWork() {
  const work = useQuery(openWorkQuery);
  const data = work.data;
  const [kind, setKind] = useState<"all" | "issue" | "pr">("all");
  const [repo, setRepo] = useState("all");
  // A clock, so "Updated 12s ago" is true a minute after it was rendered.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  const rows = data?.all ?? emptyRows;
  const repos = useMemo(
    () => [...new Set(rows.map((row) => row.repo))].sort(),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (kind === "all" || row.kind === kind) &&
          (repo === "all" || row.repo === repo),
      ),
    [rows, kind, repo],
  );
  const table = useTable({
    features,
    columns,
    data: filtered.length ? filtered : emptyRows,
    getRowId: (row) => String(row.id),
    initialState: { sorting: [{ id: "age", desc: false }] },
  });

  if (work.isPending)
    return (
      <div className="space-y-4" aria-label="Loading open work">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );

  const counts = data?.counts;
  const connected = data?.connected ?? false;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Figure label="Assigned to me" value={counts?.assigned ?? 0} />
          <Figure label="Reviews waiting" value={counts?.reviewRequested ?? 0} />
          <Figure label="Open PRs" value={counts?.openPrs ?? 0} />
          <Figure label="Open issues" value={counts?.openIssues ?? 0} />
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
          <section className="min-w-0">
            <h2 className="section-title">Mine</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What is waiting on you, oldest first
            </p>
            <div className="mt-5 grid gap-6 lg:grid-cols-3 lg:gap-8">
              <Group
                title="Assigned to me"
                items={data?.me.assigned ?? []}
                empty="Nothing assigned to you."
              />
              <Group
                title="Reviews waiting on me"
                items={data?.me.reviewRequested ?? []}
                empty="No reviews requested."
              />
              <Group
                title="Authored by me"
                items={data?.me.authored ?? []}
                empty="Nothing open of yours."
              />
            </div>
          </section>

          <section className="section min-w-0 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="section-title">All open</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {filtered.length === rows.length
                    ? `${rows.length} open across every repository the token reaches`
                    : `${filtered.length} of ${rows.length} open`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1.5" role="group" aria-label="Kind">
                  {(
                    [
                      ["all", "All"],
                      ["issue", "Issues"],
                      ["pr", "PRs"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium",
                        kind === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="work-repo"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Repository
                  </Label>
                  <select
                    id="work-repo"
                    className="field max-w-56"
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                  >
                    <option value="all">All</option>
                    {repos.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <DataTable
                table={table}
                empty={
                  <p className="py-6 text-muted-foreground">
                    {rows.length
                      ? "Nothing matches this filter."
                      : "Nothing open. Everything the token can see is closed."}
                  </p>
                }
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="section-label">{label}</p>
      <p className="figure mt-1.5">{value.toLocaleString("en-GB")}</p>
    </div>
  );
}

function Group({
  title,
  items,
  empty,
}: {
  title: string;
  items: WorkItem[];
  empty: string;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      {items.length ? (
        <ul className="list mt-1">
          {items.slice(0, 10).map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 py-2.5">
              <Kind item={item} />
              <div className="min-w-0 flex-1">
                <TitleLink item={item} />
                <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <span className="break-all">{item.repo}</span>
                  <span>@{item.author}</span>
                  <span className="font-mono tabular-nums">
                    {age(item.updatedAt)}
                  </span>
                </p>
                <div className="mt-1.5">
                  <Labels item={item} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
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

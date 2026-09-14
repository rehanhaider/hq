import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CircleAlert } from "lucide-react";
import { dashboardQuery, openWorkQuery } from "@/queries/dashboard";
import {
  attentionCounts,
  goingStale,
  isInboxZero,
  ownDrafts,
  reasonLabel,
  triageTop,
  waitingOnYou,
} from "@/lib/attention";
import { age } from "@/lib/openWork";
import type { WorkItem } from "@/lib/openWork";
import type { Filters } from "@/lib/model";
import { OrgAvatar } from "./OpenWork";
import { cn } from "@/lib/utils";

const number = (n: number) => n.toLocaleString("en-US");

function repoScope(repo: Filters["repo"]): string[] {
  if (repo === "all") return [];
  return Array.isArray(repo) ? repo : [repo];
}

/**
 * The GitHub module's front page: what needs doing, not what happened. Four
 * figures lead, then the waiting lists — review and assignment first, stale
 * rows and drafts next, unassigned rows last. The numbers live on Statistics;
 * the full lists live on Work.
 */
export function GithubOverview({ filters }: { filters: Filters }) {
  const work = useQuery(openWorkQuery);
  const dashboard = useQuery({
    ...dashboardQuery(filters),
    enabled: true,
  });
  const data = work.data;
  const summary = dashboard.data;
  const repos = repoScope(filters.repo);
  const mine = data?.mine ?? [];
  const waiting = waitingOnYou(mine, repos);
  const stale = goingStale(mine, repos);
  const drafts = ownDrafts(mine, data?.login, repos);
  const triage = triageTop(data?.triage ?? [], repos);
  const counts = attentionCounts(data, repos);
  const totalWaiting =
    waiting.length + stale.length + drafts.length + triage.length;
  const inboxZero = isInboxZero(data, totalWaiting, work.error);

  if (work.isPending && dashboard.isPending)
    return (
      <div className="space-y-4" aria-label="Loading overview">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );

  if (data && !data.connected)
    return (
      <div className="section flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center">
        <h2 className="font-semibold">GitHub is not connected</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Set a GitHub token on the server to see what needs doing.
        </p>
      </div>
    );

  const stats: {
    label: string;
    value: string;
    to: string;
    search: Filters;
  }[] = [
    {
      label: "Needs you",
      value: number(counts.needsYou),
      to: "/github",
      search: { ...filters, view: "work" as const, page: 1 },
    },
    {
      label: "Needs triage",
      value: number(counts.triage),
      to: "/github",
      search: { ...filters, view: "work" as const, page: 1 },
    },
    {
      label: "Merged",
      value: summary ? number(summary.total.authoredPrs) : "—",
      to: "/github",
      search: { ...filters, view: "statistics" as const, page: 1 },
    },
    {
      label: "Commits",
      value: summary ? number(summary.total.commits) : "—",
      to: "/github",
      search: { ...filters, view: "statistics" as const, page: 1 },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            to={stat.to}
            search={stat.search}
            className="card group p-4 hover:border-primary/40"
          >
            <p className="section-label">{stat.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums group-hover:text-primary">
              {stat.value}
            </p>
          </Link>
        ))}
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

      {inboxZero ? (
        <div className="section flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center">
          <h2 className="font-semibold">Nothing needs you</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            No reviews, no assignments, nothing stale. The numbers are on
            Statistics.
          </p>
          <Link
            to="/github"
            search={{ ...filters, view: "statistics", page: 1 }}
            className="mt-4 text-[0.8125rem] font-medium text-primary"
          >
            Open Statistics <ArrowRight className="inline size-3.5" />
          </Link>
        </div>
      ) : (
        <>
          <Section
            title="Waiting on you"
            count={counts.needsYou}
            action={{ label: "Open work", search: { ...filters, view: "work" as const, page: 1 } }}
          >
            {waiting.map((item) => (
              <AttentionRow key={item.id} item={item} note={reasonLabel(item)} />
            ))}
          </Section>

          <Section
            title="Going stale"
            count={stale.length}
            hint="Quiet 14+ days"
            action={{ label: "Open work", search: { ...filters, view: "work" as const, page: 1 } }}
          >
            {stale.map((item) => (
              <AttentionRow key={item.id} item={item} note={reasonLabel(item)} />
            ))}
          </Section>

          {drafts.length ? (
            <Section title="Your drafts" count={drafts.length}>
              {drafts.map((item) => (
                <AttentionRow key={item.id} item={item} note="Draft" />
              ))}
            </Section>
          ) : null}

          <Section
            title="Needs triage"
            count={counts.triage}
            action={{ label: "Open work", search: { ...filters, view: "work" as const, page: 1 } }}
          >
            {triage.map((item) => (
              <AttentionRow
                key={item.id}
                item={item}
                note={`@${item.author}`}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  action,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  action?: { label: string; search: Filters };
  children: React.ReactNode;
}) {
  return (
    <section className="card min-w-0 p-4 sm:p-5" aria-label={title}>
      <div className="flex items-center gap-2.5">
        <h2 className="section-title">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
        {action ? (
          <Link
            to="/github"
            search={action.search}
            className="ml-auto shrink-0 text-[0.8125rem] font-medium text-primary"
          >
            {action.label} <ArrowRight className="inline size-3.5" />
          </Link>
        ) : null}
      </div>
      {count ? (
        <ul className="mt-3 min-w-0">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Nothing here.</p>
      )}
    </section>
  );
}

function AttentionRow({ item, note }: { item: WorkItem; note: string }) {
  return (
    <li className="min-w-0">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/60"
      >
        <OrgAvatar repo={item.repo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {shortRepo(item.repo)} · #{item.number}
          </span>
        </span>
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium sm:inline",
            item.draft
              ? "bg-warning/15 text-warning"
              : "bg-primary/10 text-primary",
          )}
        >
          {note}
        </span>
        <span
          className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums"
          title={`Updated ${item.updatedAt}`}
        >
          {age(item.updatedAt)}
        </span>
        <ArrowUpRight
          className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
          aria-hidden
        />
      </a>
    </li>
  );
}

function shortRepo(repo: string) {
  const slash = repo.indexOf("/");
  return slash < 0 ? repo : repo.slice(slash + 1);
}

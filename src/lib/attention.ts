import { age, byOldestUpdated, countKinds } from "./openWork";
import type { OpenWork, WorkItem, WorkReason } from "./openWork";
import type { StatusSegment } from "./nasr";

/**
 * The GitHub Overview answers one question: what needs doing. Everything
 * here is pure — the page feeds it the live work lists and renders what
 * comes back. Oldest first throughout: the thing waiting longest is the
 * thing most likely overdue.
 */

/** Untouched this long, a row is stale rather than merely open. */
export const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 86400000;

/** Nothing has happened on the row for STALE_DAYS or more. */
export function isStale(updatedAt: string, now = Date.now()) {
  const then = Date.parse(updatedAt);
  return Number.isFinite(then) && now - then >= STALE_MS;
}

/** `"all"` is every repo; `[]` is none — the same predicate `summarize` uses. */
export type RepoFilter = string[] | "all";

function inRepos(item: WorkItem, repos: RepoFilter) {
  return repos === "all" || repos.includes(item.repo);
}

/** Someone else's work waiting on the signed-in login: review, then assignment. */
export function waitingOnYou(
  mine: WorkItem[],
  repos: RepoFilter = "all",
  limit = 5,
): WorkItem[] {
  return mine
    .filter(
      (item) =>
        inRepos(item, repos) &&
        (item.reasons.includes("review") || item.reasons.includes("assigned")),
    )
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** Open and quiet: nothing has happened on the row for two weeks. */
export function goingStale(
  mine: WorkItem[],
  repos: RepoFilter = "all",
  limit = 5,
  now = Date.now(),
): WorkItem[] {
  return mine
    .filter((item) => inRepos(item, repos) && isStale(item.updatedAt, now))
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** Draft pull requests the signed-in login opened and never finished. */
export function ownDrafts(
  mine: WorkItem[],
  login: string | undefined,
  repos: RepoFilter = "all",
  limit = 5,
): WorkItem[] {
  return mine
    .filter(
      (item) =>
        item.kind === "pr" &&
        item.draft &&
        inRepos(item, repos) &&
        (!login || item.author.toLowerCase() === login.toLowerCase()),
    )
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** The oldest rows nobody has picked up. */
export function triageTop(
  triage: WorkItem[],
  repos: RepoFilter = "all",
  limit = 5,
): WorkItem[] {
  return triage
    .filter((item) => inRepos(item, repos))
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** Why the row is on the page, review first: one reason per row. */
export function reasonLabel(
  item: Pick<WorkItem, "reasons"> & { unassigned?: boolean },
): string {
  const reasons: WorkReason[] = ["review", "assigned", "authored"];
  const first = reasons.find((reason) => item.reasons.includes(reason));
  if (first === "review") return "Review requested";
  if (first === "assigned") return "Assigned to you";
  if (first === "authored") return "You opened";
  return item.unassigned ? "Needs triage" : "Open";
}

export type AttentionCounts = {
  needsYou: number;
  triage: number;
  openIssues: number;
  openPrs: number;
};

/** The four figures the Overview leads with. Same repo scope as the lists. */
export function attentionCounts(
  work: OpenWork | undefined,
  repos: RepoFilter = "all",
): AttentionCounts {
  const mine = work?.mine ?? [];
  const kinds = countKinds(mine.filter((item) => inRepos(item, repos)));
  return {
    needsYou: waitingOnYou(mine, repos, Number.MAX_SAFE_INTEGER).length,
    triage: (work?.triage ?? []).filter((item) => inRepos(item, repos)).length,
    openIssues: kinds.issues,
    openPrs: kinds.prs,
  };
}

/**
 * Inbox-zero is a claim that the lists are empty, not a stand-in for a
 * failed or partial fetch. Disconnected and errored payloads stay out.
 */
export function isInboxZero(
  work: OpenWork | undefined,
  totalWaiting: number,
  queryError?: unknown,
): boolean {
  if (!work?.connected) return false;
  if (queryError || work.error) return false;
  return totalWaiting === 0;
}

/**
 * Only what Home shows of open work. Home renders it on the server, and the
 * whole feed runs to tens of kilobytes: serialising that into the page cost
 * Home about five milliseconds of its first byte.
 */
export type AttentionSummary = {
  connected: boolean;
  fetchedAt: string;
  error?: string;
  needsYou: number;
  triage: number;
  stale: number;
  /** Rows waiting on your review, and when the quietest of them last moved. */
  reviews: { count: number; quietSince: string | null };
  /** The first rows of Waiting on you, in the Overview's order. */
  waiting: Pick<
    WorkItem,
    "id" | "url" | "repo" | "number" | "title" | "updatedAt" | "reasons" | "draft"
  >[];
};

/** The Overview's figures and its first five waiting rows, cut down for Home. */
export function summariseAttention(
  feed: OpenWork,
  now = Date.now(),
): AttentionSummary {
  const every = Number.MAX_SAFE_INTEGER;
  const reviews = feed.mine
    .filter((item) => item.reasons.includes("review"))
    .sort(byOldestUpdated);
  return {
    connected: feed.connected,
    fetchedAt: feed.fetchedAt,
    ...(feed.error ? { error: feed.error } : {}),
    needsYou: waitingOnYou(feed.mine, "all", every).length,
    triage: feed.triage.length,
    stale: goingStale(feed.mine, "all", every, now).length,
    reviews: {
      count: reviews.length,
      quietSince: reviews[0]?.updatedAt ?? null,
    },
    waiting: waitingOnYou(feed.mine).map(
      ({ id, url, repo, number, title, updatedAt, reasons, draft }) => ({
        id,
        url,
        repo,
        number,
        title,
        updatedAt,
        reasons,
        draft,
      }),
    ),
  };
}

/**
 * The GitHub part of Home's status line: review requests and how long the
 * quietest has waited, then everything that needs you. Nothing while GitHub
 * is not connected, because a zero there would not be a fact.
 */
export function attentionStatus(
  summary: AttentionSummary | null | undefined,
  now = Date.now(),
): StatusSegment[] {
  if (!summary?.connected) return [];
  const segments: StatusSegment[] = [];
  const { count, quietSince } = summary.reviews;
  if (count > 0)
    segments.push({
      id: "reviews",
      card: "waiting",
      lead: String(count),
      text: count === 1 ? "review waiting" : "reviews waiting",
      tail: quietSince ? age(quietSince, now) : undefined,
    });
  if (summary.needsYou > 0)
    segments.push({
      id: "needs",
      card: "waiting",
      lead: String(summary.needsYou),
      text: summary.needsYou === 1 ? "needs you" : "need you",
    });
  return segments;
}

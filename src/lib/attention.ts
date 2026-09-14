import { byOldestUpdated, countKinds } from "./openWork";
import type { OpenWork, WorkItem, WorkReason } from "./openWork";

/**
 * The GitHub Overview answers one question: what needs doing. Everything
 * here is pure — the page feeds it the live work lists and renders what
 * comes back. Oldest first throughout: the thing waiting longest is the
 * thing most likely overdue.
 */

/** Untouched this long, a row is stale rather than merely open. */
export const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 86400000;

function updatedBefore(item: WorkItem, now: number, ms: number) {
  const then = Date.parse(item.updatedAt);
  return Number.isFinite(then) && now - then >= ms;
}

function inRepos(item: WorkItem, repos: string[]) {
  return repos.length === 0 || repos.includes(item.repo);
}

/** Someone else's work waiting on the signed-in login: review, then assignment. */
export function waitingOnYou(
  mine: WorkItem[],
  repos: string[] = [],
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
  repos: string[] = [],
  limit = 5,
  now = Date.now(),
): WorkItem[] {
  return mine
    .filter((item) => inRepos(item, repos) && updatedBefore(item, now, STALE_MS))
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** Draft pull requests the signed-in login opened and never finished. */
export function ownDrafts(
  mine: WorkItem[],
  login: string | undefined,
  repos: string[] = [],
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
  repos: string[] = [],
  limit = 5,
): WorkItem[] {
  return triage
    .filter((item) => inRepos(item, repos))
    .sort(byOldestUpdated)
    .slice(0, Math.max(0, limit));
}

/** Why the row is on the page, review first: one reason per row. */
export function reasonLabel(item: WorkItem): string {
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
  repos: string[] = [],
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

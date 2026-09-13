import { z } from "zod";

/**
 * Open issues and pull requests as the app reads them: one shape for both,
 * because a thing waiting on you is a thing waiting on you whether it carries
 * a diff or not. Everything here is pure — the fetching, caching, and token
 * handling live on the server side.
 */
export type WorkLabel = { name: string; color: string };
export type WorkItem = {
  id: number;
  kind: "issue" | "pr";
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: WorkLabel[];
  draft: boolean;
  assignedToMe: boolean;
};
export type WorkCounts = {
  assigned: number;
  reviewRequested: number;
  openPrs: number;
  openIssues: number;
};
export type OpenWork = {
  connected: boolean;
  me: {
    assigned: WorkItem[];
    reviewRequested: WorkItem[];
    authored: WorkItem[];
  };
  all: WorkItem[];
  counts: WorkCounts;
  fetchedAt: string;
  error?: string;
};

export const searchItemSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  repository_url: z.string(),
  user: z.object({ login: z.string() }).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  draft: z.boolean().optional(),
  pull_request: z.unknown().optional(),
  labels: z
    .array(z.object({ name: z.string(), color: z.string().nullable().optional() }))
    .optional(),
  assignees: z.array(z.object({ login: z.string() })).nullable().optional(),
  assignee: z.object({ login: z.string() }).nullable().optional(),
});
export type SearchItem = z.infer<typeof searchItemSchema>;
export const searchResponseSchema = z.object({
  total_count: z.number().optional(),
  incomplete_results: z.boolean().optional(),
  items: z.array(searchItemSchema),
});

/** `https://api.github.com/repos/owner/name` — the only place the repo name is. */
export function repoOf(repositoryUrl: string) {
  const parts = repositoryUrl.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export function normalise(raw: SearchItem, login: string): WorkItem {
  const me = login.toLowerCase();
  const assignees = [
    ...(raw.assignees ?? []),
    ...(raw.assignee ? [raw.assignee] : []),
  ];
  return {
    id: raw.id,
    kind: raw.pull_request ? "pr" : "issue",
    repo: repoOf(raw.repository_url),
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    author: raw.user?.login ?? "unknown",
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    labels: (raw.labels ?? []).map((label) => ({
      name: label.name,
      color: label.color ?? "",
    })),
    draft: raw.draft ?? false,
    assignedToMe: assignees.some(
      (assignee) => assignee.login.toLowerCase() === me,
    ),
  };
}

export function normaliseAll(raws: SearchItem[], login: string) {
  return dedupe(raws.map((raw) => normalise(raw, login)));
}

/**
 * The same issue comes back from several searches — assigned to me, in an org
 * I belong to, authored by me. One row per id, and an assignment seen in any
 * of them sticks.
 */
export function dedupe(items: WorkItem[]) {
  const byId = new Map<number, WorkItem>();
  for (const item of items) {
    const seen = byId.get(item.id);
    if (!seen) byId.set(item.id, item);
    else if (item.assignedToMe && !seen.assignedToMe)
      byId.set(item.id, { ...seen, assignedToMe: true });
  }
  return [...byId.values()];
}

export function byOldestUpdated(a: WorkItem, b: WorkItem) {
  return (
    a.updatedAt.localeCompare(b.updatedAt) || a.repo.localeCompare(b.repo) || a.number - b.number
  );
}
export function byOldestCreated(a: WorkItem, b: WorkItem) {
  return (
    a.createdAt.localeCompare(b.createdAt) || a.repo.localeCompare(b.repo) || a.number - b.number
  );
}

export function countWork(
  all: WorkItem[],
  assigned: WorkItem[],
  reviewRequested: WorkItem[],
): WorkCounts {
  return {
    assigned: assigned.length,
    reviewRequested: reviewRequested.length,
    openPrs: all.filter((item) => item.kind === "pr").length,
    openIssues: all.filter((item) => item.kind === "issue").length,
  };
}

/**
 * Everything the searches found, folded into one answer. The per-repo sweep
 * misses anything assigned to me in a repository I neither own nor belong to,
 * so the three personal searches are folded into `all` as well.
 */
export function buildOpenWork(
  lists: {
    assigned: WorkItem[];
    reviewRequested: WorkItem[];
    authored: WorkItem[];
    everything: WorkItem[];
  },
  fetchedAt: string,
  error?: string,
): OpenWork {
  const assigned = dedupe(lists.assigned).sort(byOldestCreated);
  const reviewRequested = dedupe(lists.reviewRequested).sort(byOldestCreated);
  const authored = dedupe(lists.authored).sort(byOldestCreated);
  const assignedIds = new Set(assigned.map((item) => item.id));
  const all = dedupe([
    ...lists.everything,
    ...assigned,
    ...reviewRequested,
    ...authored,
  ])
    .map((item) =>
      assignedIds.has(item.id) ? { ...item, assignedToMe: true } : item,
    )
    .sort(byOldestUpdated);
  return {
    connected: true,
    me: { assigned, reviewRequested, authored },
    all,
    counts: countWork(all, assigned, reviewRequested),
    fetchedAt,
    ...(error ? { error } : {}),
  };
}

export function emptyOpenWork(
  fetchedAt: string,
  error?: string,
  connected = true,
): OpenWork {
  return {
    connected,
    me: { assigned: [], reviewRequested: [], authored: [] },
    all: [],
    counts: { assigned: 0, reviewRequested: 0, openPrs: 0, openIssues: 0 },
    fetchedAt,
    ...(error ? { error } : {}),
  };
}

/**
 * The sweep across everything the account reaches. GitHub's search ANDs a
 * repeated `user:`/`org:`/`repo:` qualifier — two owners at once match
 * nothing — so the owners are OR'd inside one query instead, and the query is
 * split so no single one carries an unreasonable pile of terms.
 */
const TERMS_PER_QUERY = 6;
/** Past four batches the collaborations are a long tail, not a workload. */
const MAX_COLLABORATION_QUERIES = 4;
function chunk(values: string[], size: number) {
  const out: string[][] = [];
  for (const value of values) {
    const last = out.at(-1);
    if (last && last.length < size) last.push(value);
    else out.push([value]);
  }
  return out;
}
export function sweepQueries(
  login: string,
  orgs: string[],
  collaborations: string[],
) {
  const owners = [`user:${login}`, ...orgs.map((org) => `org:${org}`)];
  const groups = chunk(owners, TERMS_PER_QUERY);
  // A repository I only collaborate on belongs to neither me nor an org I am
  // in, so it has to be named outright.
  const repos = chunk(
    collaborations.map((repo) => `repo:${repo}`),
    TERMS_PER_QUERY,
  );
  const used = repos.slice(0, MAX_COLLABORATION_QUERIES);
  return {
    queries: [...groups, ...used].map(
      (group) => `is:open (${group.join(" OR ")})`,
    ),
    skipped: collaborations.length - used.flat().length,
  };
}

/** How long a thing has been waiting, in one or two characters plus a unit. */
export function age(iso: string, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 28) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}


/**
 * How the Work view is being read: one list at a time. The tab is the first
 * filter, the rest narrow it, and the arranging below is pure so the view can
 * stay a rendering of it.
 */
export type WorkTab = "assigned" | "reviews" | "authored" | "all";
export type WorkKind = "both" | "issue" | "pr";
export type WorkSort = "recent" | "oldest";
export type WorkView = {
  kind: WorkKind;
  repo: string;
  search: string;
  sort: WorkSort;
  limit: number;
};
export type WorkGroup = { repo: string; items: WorkItem[] };

/** The one list a tab stands for. */
export function tabItems(work: OpenWork | undefined, tab: WorkTab): WorkItem[] {
  if (!work) return [];
  if (tab === "assigned") return work.me.assigned;
  if (tab === "reviews") return work.me.reviewRequested;
  if (tab === "authored") return work.me.authored;
  return work.all;
}

export function matchesWork(
  item: WorkItem,
  filter: { kind: WorkKind; repo: string; search: string },
) {
  if (filter.kind !== "both" && item.kind !== filter.kind) return false;
  if (filter.repo !== "all" && item.repo !== filter.repo) return false;
  const needle = filter.search.trim().toLowerCase();
  return !needle || item.title.toLowerCase().includes(needle);
}

export function byRecentUpdated(a: WorkItem, b: WorkItem) {
  return -byOldestUpdated(a, b);
}

/** The repositories in a list, the fullest first, for the repository select. */
export function repoOptions(items: WorkItem[]) {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
  return [...counts]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));
}

/**
 * Filter, sort, cut to what is on screen, then gather into repositories in
 * the order they first appear — so the groups follow the sort rather than
 * fighting it.
 */
export function arrangeWork(items: WorkItem[], view: WorkView) {
  const matched = items.filter((item) => matchesWork(item, view));
  const sorted = [...matched].sort(
    view.sort === "oldest" ? byOldestUpdated : byRecentUpdated,
  );
  const shown = sorted.slice(0, Math.max(0, view.limit));
  const groups = new Map<string, WorkGroup>();
  for (const item of shown) {
    const group = groups.get(item.repo);
    if (group) group.items.push(item);
    else groups.set(item.repo, { repo: item.repo, items: [item] });
  }
  return { total: matched.length, shown: shown.length, groups: [...groups.values()] };
}

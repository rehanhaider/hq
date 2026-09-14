import { z } from "zod";

/**
 * Open issues and pull requests as the app reads them: one shape for both,
 * because a thing waiting on you is a thing waiting on you whether it carries
 * a diff or not. Everything here is pure — the fetching, caching, and token
 * handling live on the server side.
 */
export type WorkLabel = { name: string; color: string };
/** Which search found the row: why it is waiting on the signed-in login. */
export type WorkReason = "assigned" | "review" | "authored";
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
  /** Nobody has picked it up: the one thing that makes a row triage. */
  unassigned: boolean;
  reasons: WorkReason[];
};
/**
 * Two lists, because there are two reasons to look: the work that is mine,
 * and the work in my repositories that nobody has taken. Counts are not
 * carried here — the view recomputes them from whatever it is showing.
 */
export type OpenWork = {
  connected: boolean;
  /** The signed-in GitHub login, when the lists were loaded for an account. */
  login?: string;
  mine: WorkItem[];
  triage: WorkItem[];
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

export function normalise(raw: SearchItem): WorkItem {
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
    unassigned: assignees.length === 0,
    reasons: [],
  };
}

export function normaliseAll(raws: SearchItem[]) {
  return dedupe(raws.map(normalise));
}

/**
 * The same issue comes back from several searches — assigned to me, in an org
 * I belong to, authored by me. One row per id.
 */
export function dedupe(items: WorkItem[]) {
  const byId = new Map<number, WorkItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * The dedupe that remembers: one row per id, keeping every reason it was
 * found for in search order.
 */
function withReasons(lists: { items: WorkItem[]; reason: WorkReason }[]) {
  const byId = new Map<number, WorkItem>();
  for (const { items, reason } of lists)
    for (const item of items) {
      const seen = byId.get(item.id);
      if (seen) {
        if (!seen.reasons.includes(reason)) seen.reasons.push(reason);
      } else byId.set(item.id, { ...item, reasons: [reason] });
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

/** Issues and pull requests apart, for the figures on the home page. */
export function countKinds(items: WorkItem[]) {
  return {
    issues: items.filter((item) => item.kind === "issue").length,
    prs: items.filter((item) => item.kind === "pr").length,
  };
}

/**
 * The two lists. Mine is the union of the three personal searches — assigned
 * to me, waiting on my review, opened by me — deduped into one row per id.
 * Triage is everything the sweep across my repositories found that nobody has
 * been given; a thing of mine with no assignee is in both, which is true.
 *
 * Each row of mine keeps every search that found it, so a view can say why
 * the row is waiting: review first, then assignment, then authorship.
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
  login?: string,
): OpenWork {
  const mine = withReasons([
    { items: lists.assigned, reason: "assigned" },
    { items: lists.reviewRequested, reason: "review" },
    { items: lists.authored, reason: "authored" },
  ]).sort(byOldestCreated);
  const triage = dedupe(lists.everything)
    .filter((item) => item.unassigned)
    .sort(byOldestCreated);
  return {
    connected: true,
    mine,
    triage,
    fetchedAt,
    ...(login ? { login } : {}),
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
    mine: [],
    triage: [],
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
export type WorkTab = "mine" | "triage";
/** One kind of row, and the two panes the view is split into. */
export type WorkKind = WorkItem["kind"];
export type WorkSort = "recent" | "oldest";
export type WorkFilter = { repo: string; search: string };
export type WorkView = WorkFilter & { sort: WorkSort; limit: number };
export type WorkGroup = { repo: string; items: WorkItem[] };

/** The one list a tab stands for. */
export function tabItems(work: OpenWork | undefined, tab: WorkTab): WorkItem[] {
  if (!work) return [];
  return tab === "triage" ? work.triage : work.mine;
}

/**
 * Triage always names who opened the row. Mine only does when it is not the
 * signed-in login — assigned and review-requested rows are often someone
 * else's, and hiding `@author` there drops the one thing that said so.
 */
export function showsAuthor(item: WorkItem, tab: WorkTab, login?: string) {
  if (tab === "triage") return true;
  return !login || item.author.toLowerCase() !== login.toLowerCase();
}

/**
 * The number on each tab, read through the filters below it — otherwise the
 * tabs say one thing while the list shows another.
 */
export function tabCounts(work: OpenWork | undefined, filter: WorkFilter) {
  const count = (tab: WorkTab) =>
    tabItems(work, tab).filter((item) => matchesWork(item, filter)).length;
  return { mine: count("mine"), triage: count("triage") };
}

export function matchesWork(item: WorkItem, filter: WorkFilter) {
  if (filter.repo !== "all" && item.repo !== filter.repo) return false;
  const needle = filter.search.trim().toLowerCase();
  return !needle || item.title.toLowerCase().includes(needle);
}

/**
 * The two panes: issues on one side, pull requests on the other. Order is
 * kept, so whatever sorted the list still holds inside each half.
 */
export function splitByKind(items: WorkItem[]) {
  const issue: WorkItem[] = [];
  const pr: WorkItem[] = [];
  for (const item of items) (item.kind === "pr" ? pr : issue).push(item);
  return { issue, pr };
}

export function byRecentUpdated(a: WorkItem, b: WorkItem) {
  return -byOldestUpdated(a, b);
}

/**
 * The repositories in a list, the fullest first, for the repository select —
 * counted through the other filters so the numbers match the list.
 */
export function repoOptions(
  items: WorkItem[],
  filter: WorkFilter = { repo: "all", search: "" },
) {
  const counts = new Map<string, number>();
  for (const item of items)
    if (matchesWork(item, filter))
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

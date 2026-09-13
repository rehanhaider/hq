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
 * A label keeps its own colour, and the text on it is picked so it can be
 * read: GitHub stores the background only, and half of them are pale.
 */
export function labelChip(color: string) {
  const hex = /^[0-9a-fA-F]{6}$/.test(color) ? color : null;
  if (!hex) return { background: "var(--track)", color: "var(--foreground)" };
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return {
    background: `#${hex}`,
    color: luminance > 0.35 ? "#1c1b19" : "#ffffff",
  };
}

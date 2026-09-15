import { z } from "zod";
import {
  buildOpenWork,
  emptyOpenWork,
  normaliseAll,
  searchResponseSchema,
  sweepQueries,
} from "../lib/openWork";
import type { OpenWork, WorkItem } from "../lib/openWork";
import { getStore } from "./db";
import { github, type GithubClient } from "./github";

/**
 * Open work is read live from GitHub's own search, not from the imported
 * snapshots: it has to cover every repository the token can see, including
 * ones this app was never told about. Search allows 30 requests a minute, so
 * every query is cached for a minute and concurrent callers share one flight.
 */
const TTL = 60000;
/** The account, its orgs, and the repos it only collaborates on move slowly. */
const ACCOUNT_TTL = 300000;
/** Three pages of a hundred is as deep as any of these lists needs to go. */
const CAP = 300;

type Cached<T> = { at: number; value: T };
const cache = new Map<string, Cached<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function memo<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<{ value?: T; error?: string }> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return { value: hit.value };
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) {
    try {
      return { value: await running };
    } catch (error) {
      return stale(hit, error);
    }
  }
  const flight = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, flight);
  try {
    return { value: await flight };
  } catch (error) {
    return stale(hit, error);
  }
}
/** A failed refresh falls back to whatever was last known, and says so. */
function stale<T>(
  hit: Cached<T> | undefined,
  error: unknown,
): { value?: T; error: string } {
  const message =
    error instanceof Error ? error.message : "GitHub could not be reached.";
  return hit ? { value: hit.value, error: message } : { error: message };
}

async function searchPages(client: GithubClient, query: string) {
  const raw: z.infer<typeof searchResponseSchema>["items"] = [];
  for (let page = 1; page * 100 <= CAP; page++) {
    const response = await client.request(
      `/search/issues?${new URLSearchParams({
        q: query,
        per_page: "100",
        page: String(page),
        advanced_search: "true",
      })}`,
    );
    const body = searchResponseSchema.parse(response.body);
    raw.push(...body.items);
    if (body.items.length < 100 || !response.next) break;
  }
  return raw;
}

const orgsSchema = z.array(z.object({ login: z.string() }));
const reposSchema = z.array(z.object({ full_name: z.string() }));

async function pool<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const index = next++;
        const item = items[index];
        if (index >= items.length || item === undefined) return;
        out[index] = await work(item);
      }
    }),
  );
  return out;
}

/**
 * The whole feed is served stale-while-revalidate. A sweep costs a dozen
 * search round trips and ten to thirty seconds on the Pi, so a page should
 * never wait on one: whatever was last assembled is returned at once, and a
 * fresh sweep runs behind it when the copy is older than FEED_TTL. The last
 * result is also kept in SQLite so a restart does not start from cold.
 */
export const FEED_TTL = 5 * 60000;
const FEED_KEY = "openWork";
let feed: Cached<OpenWork> | null | undefined;
let sweeping: Promise<OpenWork> | null = null;

function storedFeed(): Cached<OpenWork> | null {
  if (feed !== undefined) return feed;
  const saved = getStore().read<OpenWork>(FEED_KEY);
  feed = saved ? { at: Date.parse(saved.fetchedAt), value: saved } : null;
  return feed;
}

function sweep(): Promise<OpenWork> {
  if (sweeping) return sweeping;
  sweeping = loadOpenWork()
    .then((value) => {
      // A run that could not even log in tells us nothing new; keep the
      // last good copy rather than replace it with an empty one.
      if (value.connected || !storedFeed()) {
        feed = { at: Date.now(), value };
        getStore().write(FEED_KEY, value);
      }
      return value;
    })
    .finally(() => {
      sweeping = null;
    });
  return sweeping;
}

export function feedIsFresh(now = Date.now()) {
  const hit = storedFeed();
  return Boolean(hit && now - hit.at < FEED_TTL);
}

/** Refresh in the background when the copy is stale; never throws. */
export function warmOpenWork() {
  if (feedIsFresh()) return;
  void sweep().catch(() => {});
}

/** What the page reads: the cached feed if there is one, else a live sweep. */
export async function openWork(): Promise<OpenWork> {
  const hit = storedFeed();
  if (!hit) return sweep();
  warmOpenWork();
  return hit.value;
}

export async function loadOpenWork(): Promise<OpenWork> {
  const fetchedAt = new Date().toISOString();
  let client: GithubClient;
  try {
    client = github();
  } catch (error) {
    return emptyOpenWork(
      fetchedAt,
      error instanceof Error ? error.message : "GitHub is not connected.",
      false,
    );
  }
  const errors: string[] = [];
  const note = (message?: string) => {
    if (message && !errors.includes(message)) errors.push(message);
  };

  const account = await memo("user", ACCOUNT_TTL, () => client.user());
  note(account.error);
  const login = account.value?.login;
  if (!login)
    return emptyOpenWork(fetchedAt, errors[0] ?? "GitHub is not connected.", false);

  const orgs = await memo("orgs", ACCOUNT_TTL, async () =>
    orgsSchema.parse((await client.request("/user/orgs?per_page=100")).body),
  );
  note(orgs.error);
  const collaborations = await memo("collaborations", ACCOUNT_TTL, async () =>
    reposSchema.parse(
      (await client.request("/user/repos?affiliation=collaborator&per_page=100")).body,
    ),
  );
  note(collaborations.error);

  const { queries, skipped } = sweepQueries(
    login,
    (orgs.value ?? []).map((org) => org.login),
    (collaborations.value ?? []).map((repo) => repo.full_name),
  );
  if (skipped)
    note(
      `${skipped} collaborator repositories were left out of the full sweep; work assigned to you there still appears.`,
    );

  const run = async (query: string) => {
    const result = await memo(`search:${query}`, TTL, () =>
      searchPages(client, query),
    );
    note(result.error);
    return normaliseAll(result.value ?? []);
  };

  // A few at a time: search allows thirty requests a minute, and one query
  // after another is slow enough that the page waits on it.
  const all = [
    "is:open assignee:@me",
    "is:open review-requested:@me",
    "is:open author:@me",
    ...queries,
  ];
  const results = await pool(all, 6, run);
  const [assigned = [], reviewRequested = [], authored = []] = results;
  const everything = results.slice(3).flat();

  return buildOpenWork(
    { assigned, reviewRequested, authored, everything },
    fetchedAt,
    errors.length ? errors.join(" ") : undefined,
    login,
  );
}

import { z } from "zod";
import { languageOf } from "../lib/languages";
import { categorize } from "../lib/metrics";
import { isFatalImportError } from "../lib/connections";
import type {
  Changes,
  Commit,
  ImportInput,
  ImportStatus,
  PullRequest,
  Snapshot,
} from "../lib/model";
import { ActivityStore, getStore } from "./db";
import {
  commitListSchema,
  commitSchema,
  compareSchema,
  GithubClient,
  github,
} from "./github";
import { warmOpenWork } from "./openWork";

/**
 * Reads one repository. A first import or a backfill lists commits by date
 * from `since`. An incremental refresh (`incremental`) resumes from the saved
 * snapshot instead: commits from the stored default-branch head, merged pull
 * requests from that snapshot's `until`.
 */
export async function importRepository(
  client: GithubClient,
  store: ActivityStore,
  name: string,
  login: string,
  since: string,
  until: string,
  progress: (message: string) => void,
  incremental = false,
): Promise<Snapshot> {
  const repo = await client.repository(name);
  const saved = store.snapshot(name);
  const resume = incremental ? saved : null;
  const old = new Map(saved?.commits.map((c) => [c.sha, c]) ?? []);
  const commits: Commit[] = [];
  // Pin the branch before paginating so concurrent pushes cannot shift pages.
  const heads = await client.request(
    `/repos/${name}/commits?per_page=1&sha=${encodeURIComponent(repo.defaultBranch)}`,
  );
  const head = commitListSchema.parse(heads.body)[0]?.sha;
  async function read(shas: string[], from: string) {
    for (let offset = 0; offset < shas.length; offset += 4) {
      const batch = shas.slice(offset, offset + 4);
      const results = await Promise.allSettled(
        batch.map(async (sha) => {
          const cached = old.get(sha);
          if (cached?.languages) return cached;
          const first = await client.request(
            `/repos/${name}/commits/${sha}?per_page=100`,
          );
          const detail = commitSchema.parse(first.body);
          const files = [...detail.files];
          let next = first.next;
          for (let filePage = 2; next; filePage++) {
            if (filePage > 30) break;
            const more = await client.request(
              `/repos/${name}/commits/${sha}?per_page=100&page=${filePage}`,
            );
            files.push(
              ...z.object({ files: commitSchema.shape.files }).parse(more.body)
                .files,
            );
            next = more.next;
          }
          const grouped: Commit["categories"] = {};
          const languages: Record<string, Changes> = {};
          for (const file of files) {
            const language = languageOf(file.filename);
            const languageChanges = (languages[language] ??= {
              additions: 0,
              deletions: 0,
            });
            languageChanges.additions += file.additions;
            languageChanges.deletions += file.deletions;
            const category = categorize(file.filename);
            const value: Changes = (grouped[category] ??= {
              additions: 0,
              deletions: 0,
            });
            value.additions += file.additions;
            value.deletions += file.deletions;
          }
          const sums = files.reduce(
            (a, f) => ({
              additions: a.additions + f.additions,
              deletions: a.deletions + f.deletions,
            }),
            { additions: 0, deletions: 0 },
          );
          const remainder = {
            additions: detail.stats.additions - sums.additions,
            deletions: detail.stats.deletions - sums.deletions,
          };
          if (remainder.additions < 0 || remainder.deletions < 0) {
            // Conflicting file totals cannot safely be apportioned to languages.
            for (const key of Object.keys(grouped))
              delete grouped[key as keyof typeof grouped];
            for (const key of Object.keys(languages)) delete languages[key];
            grouped.Unclassified = { ...detail.stats };
            languages.Unclassified = { ...detail.stats };
          } else if (remainder.additions || remainder.deletions) {
            grouped.Unclassified = remainder;
            languages.Unclassified = remainder;
          }
          return {
            sha,
            title: detail.commit.message.split("\n")[0] ?? sha,
            url: detail.html_url,
            date: new Date(detail.commit.committer.date).toISOString(),
            merge: detail.parents.length > 1,
            ...detail.stats,
            categories: grouped,
            languages,
          } satisfies Commit;
        }),
      );
      const failed = results.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      for (const result of results)
        if (result.status === "fulfilled" && result.value.date >= from)
          commits.push(result.value);
      progress(`${name} · ${commits.length.toLocaleString()} commits read`);
    }
  }
  // The commits a moved head added, or null when only a date listing can
  // tell: no stored head, a force push, or a comparison GitHub cut short.
  let added: string[] | null = null;
  if (head && resume?.head === head) added = [];
  else if (head && resume?.head)
    added = await compareHeads(client, name, resume.head, head, login);
  // A date listing is authoritative for commits dated from `listedSince`, so
  // the merge drops saved ones there that left the branch.
  let listedSince = resume ? until : since;
  if (head && added) await read(added, resume!.since);
  else if (head) {
    if (resume) listedSince = lateWindowStart(resume);
    // The pinned head bounds the listing, not `until`: a commit pushed after
    // the run started but before this head was read would otherwise be left
    // out while its head is saved, and the next refresh would skip it.
    for (let page = 1; ; page++) {
      const response = await client.request(
        `/repos/${name}/commits?${new URLSearchParams({ sha: head, author: login, since: listedSince, per_page: "100", page: String(page) })}`,
      );
      await read(
        commitListSchema.parse(response.body).map((item) => item.sha),
        listedSince,
      );
      if (!response.next) break;
    }
  }
  // GitHub sets mergedAt itself, so it cannot predate the last fetch.
  const prSince = resume ? resume.until : since;
  const prs: PullRequest[] = [];
  let cursor: string | null = null;
  do {
    const pulls = await client.pulls(name, cursor);
    for (const pr of pulls.nodes) {
      if (!pr.mergedAt) continue;
      const mergedAt = new Date(pr.mergedAt).toISOString();
      if (mergedAt < prSince || mergedAt > until) continue;
      if (pr.author?.login.toLowerCase() !== login.toLowerCase()) continue;
      prs.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author?.login ?? "Deleted account",
        mergedBy: pr.mergedBy?.login ?? null,
        createdAt: new Date(pr.createdAt).toISOString(),
        mergedAt,
        additions: pr.additions,
        deletions: pr.deletions,
      });
    }
    progress(
      `${name} · ${commits.length.toLocaleString()} commits, ${prs.length.toLocaleString()} merged requests read`,
    );
    if (
      !pulls.pageInfo.hasNextPage ||
      pulls.nodes.some((p) => new Date(p.updatedAt).toISOString() < prSince)
    )
      break;
    cursor = pulls.pageInfo.endCursor;
    if (!cursor)
      throw new Error("GitHub returned an incomplete pagination cursor.");
  } while (cursor);
  return {
    repo,
    commits: [...new Map(commits.map((c) => [c.sha, c])).values()],
    prs: [...new Map(prs.map((p) => [p.number, p])).values()],
    since: listedSince,
    until,
    importedAt: new Date().toISOString(),
    ...(head ? { head } : {}),
  };
}

/**
 * The account's commits reachable from `head` but not from `base`, or null
 * when the comparison cannot be trusted: `base` is gone or no longer an
 * ancestor (a force push), or GitHub returned fewer commits than it counted.
 */
async function compareHeads(
  client: GithubClient,
  name: string,
  base: string,
  head: string,
  login: string,
) {
  const shas: string[] = [];
  for (let page = 1; ; page++) {
    const response = await client.request(
      `/repos/${name}/compare/${base}...${head}?per_page=100&page=${page}`,
    );
    if (response.body === null) return null;
    const comparison = compareSchema.parse(response.body);
    if (comparison.status !== "ahead") return null;
    shas.push(
      ...comparison.commits
        .filter((c) => c.author?.login.toLowerCase() === login.toLowerCase())
        .map((c) => c.sha),
    );
    if (!response.next) {
      const seen = (page - 1) * 100 + comparison.commits.length;
      return seen === comparison.total_commits ? shas : null;
    }
  }
}

/**
 * GitHub filters commit listings by commit date, not push date, so a commit
 * made before the last fetch but pushed after it is only found by reaching
 * back. A date listing reaches this far before the repository's own `until`.
 */
export const latePushMarginMs = 48 * 60 * 60 * 1000;

export function lateWindowStart(
  previous: Pick<Snapshot, "since" | "until">,
  marginMs = latePushMarginMs,
) {
  const start = new Date(Date.parse(previous.until) - marginMs).toISOString();
  return previous.since > start ? previous.since : start;
}

export function refreshIntervalMs() {
  const raw = process.env.HQ_REFRESH_MS;
  if (raw === undefined || raw === "") return 15 * 60 * 1000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 15 * 60 * 1000;
}

/**
 * The date a repository is listed from, or null to resume from its saved
 * snapshot. Only a first import or a manual backfill to an earlier date
 * lists by date; everything else catches up from the repository's own state.
 */
export function importWindowStart(
  mode: "manual" | "refresh",
  previousSince: string | undefined,
  requestedSince: string,
) {
  if (!previousSince) return requestedSince;
  if (mode === "refresh" || requestedSince >= previousSince) return null;
  return requestedSince;
}

/**
 * Folds a fetch into the saved snapshot. Commits the fetch listed by date
 * (from `incoming.since`) replace saved ones in that range, so a commit that
 * left the branch, for example after a force push, does not linger.
 */
export function mergeSnapshot(
  previous: Snapshot | null,
  incoming: Snapshot,
): Snapshot {
  if (!previous) return incoming;
  const kept =
    incoming.since < incoming.until
      ? previous.commits.filter(
          (commit) =>
            commit.date < incoming.since || commit.date > incoming.until,
        )
      : previous.commits;
  return {
    repo: incoming.repo,
    commits: [
      ...new Map(
        [...kept, ...incoming.commits].map((commit) => [commit.sha, commit]),
      ).values(),
    ],
    prs: [
      ...new Map(
        [...previous.prs, ...incoming.prs].map((pr) => [pr.number, pr]),
      ).values(),
    ],
    since: previous.since < incoming.since ? previous.since : incoming.since,
    until: previous.until > incoming.until ? previous.until : incoming.until,
    importedAt: incoming.importedAt,
    ...(incoming.head ? { head: incoming.head } : {}),
  };
}

let running = false;
const globalRefresh = globalThis as typeof globalThis & {
  hqRefreshTimer?: ReturnType<typeof setInterval>;
};

export function ensureRefreshLoop() {
  if (process.env.VITEST) return;
  if (refreshIntervalMs() <= 0) return;
  void tickRefresh();
  if (globalRefresh.hqRefreshTimer) return;
  globalRefresh.hqRefreshTimer = setInterval(
    () => void tickRefresh(),
    Math.min(refreshIntervalMs(), 60_000),
  );
}

export function tickRefresh() {
  if (!process.env.GITHUB_TOKEN) return;
  // Search has its own rate limit, so the feed warms alongside the import
  // rather than waiting for it; a page then almost always finds a copy.
  warmOpenWork();
  if (running) return;
  const interval = refreshIntervalMs();
  if (interval <= 0) return;
  const dataset = getStore().dataset();
  if (!dataset.snapshots.length) return;
  if (dataset.status.state === "running") return;
  const finished = dataset.status.finishedAt;
  if (finished && Date.now() - Date.parse(finished) < interval) return;
  void startRefresh();
}

export async function startRefresh() {
  const names = getStore()
    .dataset()
    .snapshots.map((snapshot) => snapshot.repo.fullName);
  if (!names.length)
    return { ok: false as const, error: "Import repositories once first." };
  return startImport({ repositories: names, since: "1970-01-01" }, "refresh");
}

export async function startImport(
  input: ImportInput,
  mode: "manual" | "refresh" = "manual",
) {
  if (running)
    return { ok: false as const, error: "An import is already running." };
  running = true;
  try {
    const store = getStore();
    const client = github();
    const user = await client.user();
    store.assertAccount(user.login);
    const names = [...new Set(input.repositories)];
    const until = new Date().toISOString();
    const since = `${input.since}T00:00:00.000Z`;
    const status: ImportStatus = {
      state: "running",
      mode,
      message: mode === "refresh" ? "Refreshing activity…" : "Starting import…",
      completed: 0,
      total: names.length,
      startedAt: until,
      finishedAt: null,
    };
    store.setStatus(status);
    void (async () => {
      const failures: string[] = [];
      try {
        for (const name of names) {
          const previous = store.snapshot(name);
          const windowStart = importWindowStart(mode, previous?.since, since);
          store.setSync(name, {
            state: "syncing",
            error: null,
            lastAttemptAt: until,
          });
          store.setStatus({
            ...status,
            message:
              mode === "refresh" ? `Refreshing ${name}…` : `Reading ${name}…`,
          });
          try {
            const snapshot = await importRepository(
              client,
              store,
              name,
              user.login,
              windowStart ?? since,
              until,
              (message) => store.setStatus({ ...status, message }),
              windowStart === null,
            );
            const savedAt = new Date().toISOString();
            store.save(mergeSnapshot(previous, snapshot));
            store.setSync(name, {
              state: "ok",
              error: null,
              lastSuccessAt: savedAt,
              lastAttemptAt: savedAt,
            });
            status.completed++;
            store.setStatus({
              ...status,
              message:
                mode === "refresh" ? `${name} refreshed` : `${name} imported`,
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Could not fetch this repository.";
            store.setSync(name, {
              state: "error",
              error: message,
              lastAttemptAt: new Date().toISOString(),
            });
            failures.push(name);
            if (isFatalImportError(message)) throw error;
            store.setStatus({
              ...status,
              message: `${name} failed. Continuing…`,
            });
          }
        }
        if (failures.length) {
          store.setStatus({
            ...status,
            state: "error",
            message:
              status.completed === 0
                ? `Could not fetch ${failures.length} ${failures.length === 1 ? "repository" : "repositories"}. Open Projects.`
                : `Fetched ${status.completed} of ${names.length}. ${failures.length} failed. Open Projects.`,
            finishedAt: new Date().toISOString(),
          });
        } else {
          store.setStatus({
            ...status,
            state: "complete",
            message:
              mode === "refresh"
                ? `Caught up ${status.completed} ${status.completed === 1 ? "repository" : "repositories"}.`
                : `${status.completed} ${status.completed === 1 ? "repository" : "repositories"} imported.`,
            finishedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        store.setStatus({
          ...status,
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Import stopped. Completed repositories are saved.",
          finishedAt: new Date().toISOString(),
        });
      } finally {
        running = false;
      }
    })();
    return { ok: true as const };
  } catch (error) {
    running = false;
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to start import.",
    };
  }
}

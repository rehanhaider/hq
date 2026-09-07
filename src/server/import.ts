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
import { commitListSchema, commitSchema, GithubClient, github } from "./github";

export async function importRepository(
  client: GithubClient,
  store: ActivityStore,
  name: string,
  login: string,
  since: string,
  until: string,
  progress: (message: string) => void,
): Promise<Snapshot> {
  const repo = await client.repository(name);
  const old = new Map(
    store.snapshot(name)?.commits.map((c) => [c.sha, c]) ?? [],
  );
  const commits: Commit[] = [];
  // Pin the branch before paginating so concurrent pushes cannot shift pages.
  const heads = await client.request(
    `/repos/${name}/commits?per_page=1&sha=${encodeURIComponent(repo.defaultBranch)}`,
  );
  const head = commitListSchema.parse(heads.body)[0]?.sha;
  if (head) {
    for (let page = 1; ; page++) {
      const response = await client.request(
        `/repos/${name}/commits?${new URLSearchParams({ sha: head, author: login, since, until, per_page: "100", page: String(page) })}`,
      );
      const list = commitListSchema.parse(response.body);
      for (let offset = 0; offset < list.length; offset += 4) {
        const batch = list.slice(offset, offset + 4);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            const cached = old.get(item.sha);
            if (cached?.languages) return cached;
            const first = await client.request(
              `/repos/${name}/commits/${item.sha}?per_page=100`,
            );
            const detail = commitSchema.parse(first.body);
            const files = [...detail.files];
            let next = first.next;
            for (let filePage = 2; next; filePage++) {
              if (filePage > 30) break;
              const more = await client.request(
                `/repos/${name}/commits/${item.sha}?per_page=100&page=${filePage}`,
              );
              files.push(
                ...z
                  .object({ files: commitSchema.shape.files })
                  .parse(more.body).files,
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
              sha: item.sha,
              title: detail.commit.message.split("\n")[0] ?? item.sha,
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
          if (
            result.status === "fulfilled" &&
            result.value.date >= since &&
            result.value.date <= until
          )
            commits.push(result.value);
        progress(`${name} · ${commits.length.toLocaleString()} commits read`);
      }
      if (!response.next) break;
    }
  }
  const prs: PullRequest[] = [];
  let cursor: string | null = null;
  do {
    const pulls = await client.pulls(name, cursor);
    for (const pr of pulls.nodes) {
      if (!pr.mergedAt) continue;
      const mergedAt = new Date(pr.mergedAt).toISOString();
      if (mergedAt < since || mergedAt > until) continue;
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
      pulls.nodes.some((p) => new Date(p.updatedAt).toISOString() < since)
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
    since,
    until,
    importedAt: new Date().toISOString(),
  };
}

export const refreshOverlapMs = 48 * 60 * 60 * 1000;

export function refreshIntervalMs() {
  const raw = process.env.HQ_REFRESH_MS;
  if (raw === undefined || raw === "") return 15 * 60 * 1000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 15 * 60 * 1000;
}

export function refreshSince(
  previousSince: string,
  now: Date,
  overlapMs = refreshOverlapMs,
) {
  const overlap = new Date(now.getTime() - overlapMs).toISOString();
  return previousSince > overlap ? previousSince : overlap;
}

export function importWindowStart(
  mode: "manual" | "refresh",
  previousSince: string | undefined,
  requestedSince: string,
  until: Date,
) {
  if (!previousSince) return requestedSince;
  if (mode === "refresh" || requestedSince >= previousSince)
    return refreshSince(previousSince, until);
  return requestedSince;
}

export function mergeSnapshot(
  previous: Snapshot | null,
  incoming: Snapshot,
): Snapshot {
  if (!previous) return incoming;
  return {
    repo: incoming.repo,
    commits: [
      ...new Map(
        [...previous.commits, ...incoming.commits].map((commit) => [
          commit.sha,
          commit,
        ]),
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
  if (running) return;
  if (!process.env.GITHUB_TOKEN) return;
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
          const windowStart = importWindowStart(
            mode,
            previous?.since,
            since,
            new Date(until),
          );
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
              windowStart,
              until,
              (message) => store.setStatus({ ...status, message }),
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

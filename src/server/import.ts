import { z } from "zod";
import { languageOf } from "../lib/languages";
import { categorize } from "../lib/metrics";
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
      if (
        pr.author?.login.toLowerCase() !== login.toLowerCase() &&
        pr.mergedBy?.login.toLowerCase() !== login.toLowerCase()
      )
        continue;
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

let running = false;
export async function startImport(input: ImportInput) {
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
      message: "Starting import…",
      completed: 0,
      total: names.length,
      startedAt: until,
      finishedAt: null,
    };
    store.setStatus(status);
    void (async () => {
      try {
        for (const name of names) {
          store.setStatus({ ...status, message: `Reading ${name}…` });
          const snapshot = await importRepository(
            client,
            store,
            name,
            user.login,
            since,
            until,
            (message) => store.setStatus({ ...status, message }),
          );
          store.save(snapshot);
          status.completed++;
          store.setStatus({ ...status, message: `${name} imported` });
        }
        store.setStatus({
          ...status,
          state: "complete",
          message: `${status.completed} ${status.completed === 1 ? "repository" : "repositories"} imported.`,
          finishedAt: new Date().toISOString(),
        });
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

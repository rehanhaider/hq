import type { RepoSync, Snapshot } from "./model";

export type ConnectionState = "ok" | "syncing" | "error" | "unknown";
export type MetricCount = { ready: number; total: number };
export type ConnectionRow = {
  id: number;
  fullName: string;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  connection: ConnectionState;
  error: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  since: string;
  until: string;
  metrics: {
    commits: MetricCount;
    pullRequests: MetricCount;
    languages: MetricCount;
    additions: number;
    deletions: number;
  };
};

export function isFatalImportError(message: string) {
  return /limit reached|rejected the token|Could not reach GitHub/i.test(
    message,
  );
}

export function connectionRow(
  snapshot: Snapshot,
  sync?: RepoSync,
): ConnectionRow {
  const nonMerge = snapshot.commits.filter((commit) => !commit.merge);
  const withLanguages = nonMerge.filter((commit) => commit.languages).length;
  const connection: ConnectionState =
    sync?.state === "syncing"
      ? "syncing"
      : sync?.state === "error"
        ? "error"
        : snapshot.importedAt
          ? "ok"
          : "unknown";
  let additions = 0;
  let deletions = 0;
  for (const commit of nonMerge) {
    additions += commit.additions;
    deletions += commit.deletions;
  }
  return {
    id: snapshot.repo.id,
    fullName: snapshot.repo.fullName,
    private: snapshot.repo.private,
    language: snapshot.repo.language,
    defaultBranch: snapshot.repo.defaultBranch,
    connection,
    error: sync?.error ?? null,
    lastSuccessAt: sync?.lastSuccessAt ?? snapshot.importedAt,
    lastAttemptAt: sync?.lastAttemptAt ?? snapshot.importedAt,
    since: snapshot.since,
    until: snapshot.until,
    metrics: {
      commits: {
        ready: snapshot.commits.length,
        total: snapshot.commits.length,
      },
      pullRequests: { ready: snapshot.prs.length, total: snapshot.prs.length },
      languages: { ready: withLanguages, total: nonMerge.length },
      additions,
      deletions,
    },
  };
}

export function connectionSummary(rows: ConnectionRow[]) {
  return {
    repositories: rows.length,
    connected: rows.filter((row) => row.connection === "ok").length,
    syncing: rows.filter((row) => row.connection === "syncing").length,
    failed: rows.filter((row) => row.connection === "error").length,
    incompleteLanguages: rows.filter(
      (row) => row.metrics.languages.ready < row.metrics.languages.total,
    ).length,
  };
}

import { categories } from "./model";
import type { Category, Changes, Dataset, Filters } from "./model";

export function categorize(path: string): Category {
  const p = path.toLowerCase();
  if (
    /(^|\/)(node_modules|vendor|dist|build|generated)(\/|$)|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|uv\.lock)$|\.generated\./.test(
      p,
    )
  )
    return "Generated / dependencies";
  if (
    /(^|\/)(__tests__|tests?|specs?|e2e)(\/|$)|\.(test|spec)\.|_test\.|test_[^/]+$/.test(
      p,
    )
  )
    return "Tests";
  if (/(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|txt)$/.test(p))
    return "Documentation";
  if (
    /(^|\/)\.[^/]+|\.(json|ya?ml|toml|ini|cfg|config|tf|tfvars)$|(^|\/)(dockerfile|makefile)$/.test(
      p,
    )
  )
    return "Configuration";
  if (
    /\.(tsx?|jsx?|m?js|cjs|py|rs|go|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte|astro|css|scss|sass|html|sql|sh|bash|dart|ex|exs)$/.test(
      p,
    )
  )
    return "Code";
  return "Other";
}

export function summarize(dataset: Dataset, filters: Filters) {
  const start = `${filters.from}T00:00:00.000Z`;
  const end = `${filters.to}T23:59:59.999Z`;
  const inRange = (date: string) => date >= start && date <= end;
  const snapshots = dataset.snapshots.filter(
    (s) =>
      filters.repo === "all" ||
      (Array.isArray(filters.repo)
        ? filters.repo.includes(s.repo.fullName)
        : s.repo.fullName === filters.repo),
  );
  const login = dataset.login?.toLowerCase();
  const breakdown = Object.fromEntries(
    categories.map((c) => [c, { additions: 0, deletions: 0 }]),
  ) as Record<Category, Changes>;
  const languages = new Map<
    string,
    Changes & { commits: number; projects: Set<string> }
  >();
  let missingLanguageCommits = 0;
  const daily = new Map<
    string,
    {
      day: string;
      commits: number;
      prs: number;
      additions: number;
      deletions: number;
    }
  >();
  const getDay = (date: string) => {
    const day = date.slice(0, 10);
    if (!daily.has(day))
      daily.set(day, {
        day,
        commits: 0,
        prs: 0,
        additions: 0,
        deletions: 0,
      });
    return daily.get(day)!;
  };
  const history: {
    id: string;
    repo: string;
    kind: "commit" | "pr";
    title: string;
    url: string;
    date: string;
    additions: number;
    deletions: number;
    detail: string;
  }[] = [];
  const cycleHours: number[] = [];
  const projects = snapshots
    .map((snapshot) => {
      const commits = snapshot.commits.filter((c) => inRange(c.date));
      const prs = snapshot.prs.filter(
        (p) => inRange(p.mergedAt) && p.author.toLowerCase() === login,
      );
      let additions = 0,
        deletions = 0;
      for (const commit of commits) {
        const day = getDay(commit.date);
        day.commits++;
        if (!commit.merge) {
          if (!commit.languages) missingLanguageCommits++;
          for (const [name, changes] of Object.entries(
            commit.languages ?? {},
          )) {
            const row = languages.get(name) ?? {
              additions: 0,
              deletions: 0,
              commits: 0,
              projects: new Set<string>(),
            };
            row.additions += changes.additions;
            row.deletions += changes.deletions;
            row.commits++;
            row.projects.add(snapshot.repo.fullName);
            languages.set(name, row);
          }
          additions += commit.additions;
          deletions += commit.deletions;
          day.additions += commit.additions;
          day.deletions += commit.deletions;
          for (const [key, value] of Object.entries(commit.categories)) {
            const target = breakdown[key as Category];
            target.additions += value.additions;
            target.deletions += value.deletions;
          }
        }
        history.push({
          id: commit.sha,
          repo: snapshot.repo.fullName,
          kind: "commit",
          title: commit.title,
          url: commit.url,
          date: commit.date,
          additions: commit.merge ? 0 : commit.additions,
          deletions: commit.merge ? 0 : commit.deletions,
          detail: commit.merge
            ? "Merge commit · lines excluded"
            : commit.sha.slice(0, 7),
        });
      }
      for (const pr of prs) {
        getDay(pr.mergedAt).prs++;
        cycleHours.push(
          Math.max(0, (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3600000),
        );
        history.push({
          id: `pr-${pr.number}`,
          repo: snapshot.repo.fullName,
          kind: "pr",
          title: pr.title,
          url: pr.url,
          date: pr.mergedAt,
          additions: pr.additions,
          deletions: pr.deletions,
          detail: `#${pr.number}`,
        });
      }
      return {
        ...snapshot.repo,
        commits: commits.length,
        authoredPrs: prs.length,
        additions,
        deletions,
        since: snapshot.since,
        until: snapshot.until,
        importedAt: snapshot.importedAt,
      };
    })
    .sort(
      (a, b) => b.commits - a.commits || a.fullName.localeCompare(b.fullName),
    );
  cycleHours.sort((a, b) => a - b);
  const middle = Math.floor(cycleHours.length / 2);
  const medianHours = cycleHours.length
    ? cycleHours.length % 2
      ? cycleHours[middle]!
      : (cycleHours[middle - 1]! + cycleHours[middle]!) / 2
    : null;
  const total = projects.reduce(
    (a, p) => ({
      commits: a.commits + p.commits,
      authoredPrs: a.authoredPrs + p.authoredPrs,
      additions: a.additions + p.additions,
      deletions: a.deletions + p.deletions,
    }),
    { commits: 0, authoredPrs: 0, additions: 0, deletions: 0 },
  );
  return {
    projects,
    total,
    breakdown,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    history: history.sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    ),
    languages: [...languages]
      .map(([name, row]) => ({ name, ...row, projects: row.projects.size }))
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)),
    missingLanguageCommits,
    activeDays: [...daily.values()].filter((d) => d.commits > 0 || d.prs > 0)
      .length,
    medianHours,
    incomplete: snapshots
      .filter((s) => s.since > start || s.until < end)
      .map((s) => s.repo.fullName),
  };
}

// Aggregate small language shares without double-counting per-language commit counts.
export function groupLanguages(
  rows: {
    name: string;
    additions: number;
    deletions: number;
    commits: number;
    projects: number;
  }[],
) {
  const total = rows.reduce(
    (sum, row) => sum + row.additions + row.deletions,
    0,
  );
  const visible: {
    name: string;
    additions: number;
    deletions: number;
    commits: number | null;
    projects: number | null;
    remaining: boolean;
  }[] = [];
  const rest = rows.filter(
    (row) =>
      row.additions + row.deletions > 0 &&
      (row.additions + row.deletions) * 100 <= total,
  );
  for (const row of rows) {
    if ((row.additions + row.deletions) * 100 > total)
      visible.push({ ...row, remaining: false });
  }
  if (rest.length)
    visible.push({
      name: `Remaining ${rest.length} file ${rest.length === 1 ? "type" : "types"}`,
      additions: rest.reduce((sum, row) => sum + row.additions, 0),
      deletions: rest.reduce((sum, row) => sum + row.deletions, 0),
      commits: null,
      projects: null,
      remaining: true,
    });
  return visible;
}

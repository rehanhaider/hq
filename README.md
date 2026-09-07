# HQ

Personal dashboard for planning and daily tracking. Nasr, the 40-day practice tracker, and GitHub activity run in one TanStack Start process with two SQLite files. There is no login. The app listens on the house network.

## Application foundation and pages

Navigation has two levels. The left sidebar contains only Home and primary modules, currently Nasr and GitHub. Each module owns a horizontal page-navigation bar above its content. Module pages must not be flattened into the primary sidebar. The desktop sidebar collapses to an icon rail and remembers its state. Hover or keyboard focus previews the expanded rail without moving the content. Ctrl/Cmd+B toggles collapse. On phones, the sidebar opens as a dismissible drawer. A utility top bar holds the sidebar toggle and appearance control; module tabs remain above the content.

TanStack Start is the application framework. Its Vite plugin builds the client and server, file-based Router routes own page navigation, and Start server functions own database access. The production command serves Start's generated server entry. There is no separate application framework or custom request router.

TanStack Query owns fetched data and mutations. TanStack Router owns shareable filters and pagination. TanStack Table owns repository table sorting. The existing theme store owns only the light/dark preference. The existing shared components and stylesheet own appearance.

- Home is the daily briefing, with practice progress, a link to continue logging, and a smaller weekly coding summary.
- Nasr contains Today, Progress, and Settings. Progress separates Salah from adhkar and other practices. Notes and daily note entry are removed. Charity logging is not part of the app and old charity records are not imported or exported.
- GitHub contains Overview, Activity history, and Repositories. Repositories manages imports and stored coverage. Its existing URL remains `/github?view=projects`.

## TanStack library review

Reviewed against the official catalog on 7 September 2026. This is a library assessment, not approval to add dependencies.

| Library | Role in this app | Decision |
| --- | --- | --- |
| Start | Application build, server rendering, server functions | Already used as the framework |
| Router | File-based pages, navigation, shareable filter state | Already used within Start |
| Query | Fetching, caching, mutations, import-status polling | Already used |
| Table | Repository columns and sorting | Already used |
| Form | Settings validation and repository-import form state | Proposed addition, awaiting dependency approval; use the stable v1 line |
| Charts | Could replace custom activity and language charts | Defer; official site labels it alpha |
| Store | Could replace the current theme store | Defer; official site labels it alpha, and the current store only owns theme |
| DB | Client collections, relational live queries, optimistic writes | Defer; adds a data layer that these pages do not currently need; not a replacement for server SQLite |
| Virtual | Render only visible rows in large lists | Defer until measured list rendering warrants it; activity history is already paginated |
| Pacer | Debouncing, throttling, and work queues | Defer; the redesign does not require changing import scheduling |
| Hotkeys | Keyboard shortcut management | No new shortcut workflow is in scope |
| Markdown, Highlight | Rich text rendering and syntax highlighting | Activity records link to source code |
| AI | Agent and model integration | No AI feature is in scope |
| Devtools | Inspect library state during development | Optional future development aid, not required for this redesign |
| Config, CLI, Intent | Project tooling and library guidance | No new runtime role in the existing app |

Sources: [library catalog](https://tanstack.com/libraries), [Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch), [Form](https://tanstack.com/form/latest), [Charts](https://tanstack.com/charts/latest), [Store](https://tanstack.com/store/latest), [DB](https://tanstack.com/db/latest), [Virtual](https://tanstack.com/virtual/latest), and [Pacer](https://tanstack.com/pacer/latest).

## Run locally

Use Node 22.13 or newer and pnpm. Node 22 currently labels its built-in SQLite module experimental.

```bash
pnpm install --frozen-lockfile
GITHUB_TOKEN="$(gh auth token)" pnpm dev
```

Open port 3000 on this machine from any device on the LAN. GitHub import still needs `GITHUB_TOKEN`. Nasr does not.

To bring Nasr history across, copy the Pi database into place before the first HQ deen write, or point `NASR_DB_PATH` / `HQ_DEEN_IMPORT` at `nasr.db`. HQ copies days, notes, timezone, cycle start, and the istighfar target once. It leaves the PIN behind.

```bash
# From the Pi, after stopping Nasr:
scp pi@<pi-ip>:/opt/nasr/data/nasr.db ./data/nasr.db
```

Override database paths with `HQ_DATABASE` (GitHub) and `HQ_DEEN_DATABASE` (deen). Both default under `data/`.

The application itself reads only `GITHUB_TOKEN`; it does not call the GitHub CLI. Never put a token in a `VITE_` variable or in the browser. If you use a fine-grained token, grant read access to Metadata, Contents, and Pull requests for the repositories you select.

## Production process

```bash
pnpm build
GITHUB_TOKEN="$(gh auth token)" pnpm start
```

Development and production bind to `0.0.0.0:3000` so phones on the same network can open it. This is a house-network app with no application login. Do not put it on the public internet.

On a Raspberry Pi, install from the lockfile, build, and run the same production command. Stop Nasr (`nasr.service`) once HQ is serving deen from the imported database.

## Storage and import behavior

- GitHub data lives in `data/activity.sqlite`. Nasr data lives in `data/deen.sqlite`. Override with `HQ_DATABASE` and `HQ_DEEN_DATABASE`. Database files and credentials are ignored by Git.
- GitHub Repositories (`/github?view=projects`) is the repository list: add, remove, fetch status, and stored counts (commits, merged requests, line changes). Filter by organization. Sorted by commit count. Overview and History show activity. Old Connections URLs open Repositories.
- After the first import, HQ refreshes already-imported repositories in the background. Opening the app starts a catch-up if the last run is older than 15 minutes (`HQ_REFRESH_MS`, `0` to disable). Each refresh asks GitHub only for the last 48 hours, then merges new commits and pull requests into the saved snapshot so older history stays put.
- Add or remove repositories from Repositories. Removing a repository deletes that repository’s stored history from HQ. Pick an earlier start date only to reach before the earliest saved day. Manual import merges into what is already stored. Unselected repositories are untouched. A repository that fails to fetch is marked failed and the rest continue; token, network, and rate-limit errors stop the run.
- Each repository is saved atomically after its import or refresh finishes. A failed run preserves its previous snapshot and all other completed repositories. Status survives a restart; an interrupted run is reported as interrupted.
- Refreshes reuse details of previously saved immutable commits and re-read recent branch membership and merged requests. At most one import or refresh runs per app process. Keep that process running. Closing the browser does not stop a run. Run only one app process per database.
- API calls are paginated; commit detail reads use batches of four. Rate limits stop the run with a visible error. There are no automatic retries. The next scheduled refresh tries again after the reported limit resets.
- The importer pins each default branch to its current commit before paginating. A repository that was renamed or becomes inaccessible must be selected under its current accessible name.
- Repository discovery lists repositories the token can access through ownership, collaboration, or organization membership. It does not claim to discover every public repository you have ever contributed to.
- Current-day totals stop at the last successful refresh.
- The GitHub database is tied to the importing GitHub account; importing another account into it is rejected.

To back up or move the databases, stop the app first and copy the entire `data` directory, including SQLite sidecar files if present. Do not copy `node_modules` between machines.

## Date ranges and charts

The date toolbar provides 1W, 2W, 1M, 3M, 6M, and 1Y shortcuts. Weekly shortcuts include the Through date and cover exactly 7 or 14 UTC days. More opens 2–6 years and custom dates. The checkbox dropdown beside the date range filters by repository or any combination of organizations. All repositories clears the selection. Click a repository on Overview to select it. Completed imports do not keep a banner on the dashboard. Choose 1, 3, or 6 months, or 1 through 6 years. Presets subtract calendar months from the Through date, clamping to the last valid day; custom dates remain available. Those shortcuts only change the view. They do not change how far back GitHub history is stored. Open Repositories to add or remove a repository or to fetch commits from before the earliest saved day.

Daily shows one total per UTC day. Cumulative line accumulates those daily totals within the selected dates. Both support commits, authored requests merged, and line changes. The current day can be partial. Missing history is a gap, not zero activity; partial coverage uses faded bars. Chart controls persist in the URL. Metric buttons sit on the left and view buttons on the right above the graph. Select a day to open its records.

Languages defaults to a pie chart of additions plus deletions, with individual file types above 1% and all smaller shares grouped in the final row in both views. Pie and Table buttons switch the view and persist in the URL. The table shows additions, deletions, commits touching each language, project counts, and share of changed lines for the selected dates and repositories. Classification uses file extensions and common filenames, not repository primary language or content detection. Documentation, configuration, lockfiles, and unknown file types are included. Merge commits are excluded. Multi-language commit counts overlap. Existing imports need a background refresh (or a manual re-import) to collect language details; missing details are excluded from the language table.

## Counting contract

1. **Commits:** GitHub-attributed authored commits reachable on the imported default branch, within the selected UTC commit-date range. Merge commits count as commits. Unmerged branches, local-only commits, and commits GitHub does not associate with the account are excluded. Squashed history counts the resulting commits, not the original branch commits. The same work present in separate imported repositories counts in each repository.
2. **Lines added/deleted:** sum of GitHub's additions and deletions on non-merge commits. Merge-commit line changes are excluded to avoid counting merged changes twice. Repeated edits count repeatedly. These totals include generated files and dependency lockfiles; they do not measure net repository size or code quality.
3. **Categories:** filename/path heuristics for Code, Tests, Documentation, Configuration, Generated / dependencies, and Other. Generated paths and lockfiles take priority over other categories. Commit totals remain authoritative when GitHub file statistics are incomplete. Missing additions and deletions are recorded as Unclassified in categories and languages. If file totals exceed commit totals, the entire commit breakdown is Unclassified because it cannot be apportioned reliably. Imports continue; network and authentication failures still preserve the previous snapshot.
4. **Your requests merged:** pull requests authored by the importing account whose merge timestamps fall in the selected dates, regardless of who merged them. Requests targeting any branch are included.
5. **Pull-request line changes:** displayed only on request records. They are never added to commit line totals.
6. **Active days:** unique UTC days containing an authored commit or a merged request authored by the importing account.
7. **Median merge time:** median elapsed time from opening to merging the account's authored requests merged in the selected dates, including draft time.

Source APIs: [commits](https://docs.github.com/en/rest/commits/commits), [repository access](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), and [GraphQL pull requests](https://docs.github.com/en/graphql/reference).

## Development checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests cover UTC date boundaries, attribution, merge exclusion, category rules, snapshot replacement, account isolation, pagination, commit reuse, failure preservation, deen cycle arithmetic, streaks, adherence, and Nasr database import.

Server functions in `src/server/fns.ts` own the data boundary. Server-derived data belongs to Query. Shareable dates, repository, record type, page, and view belong to Router search parameters. Zustand owns the theme preference. Secrets and database imports stay on the server.

# GitHub HQ

A personal GitHub activity dashboard. Runs locally with TanStack Start, React, TanStack Query, Zustand, Tailwind CSS, official shadcn components using Base UI, and Node's built-in SQLite. There is one app process and one local database.

## Run locally

Use Node 22.13 or newer and pnpm. Node 22 currently labels its built-in SQLite module experimental.

```bash
pnpm install --frozen-lockfile
GITHUB_TOKEN="$(gh auth token)" pnpm dev
```

The second command uses your existing authenticated GitHub CLI. Open http://127.0.0.1:3000. Select **Import activity**, choose repositories and an import start date, then start the import. The initial date range is three calendar months. No example data is inserted.

To see repositories across your organizations, open **Import activity** and leave **Organization or owner** set to **All organizations and personal repos**. **Select all** selects every repository matching the owner and search filters, including inactive repositories. Selecting another owner's repositories preserves earlier selections. **Clear selection** clears all selections. The main dashboard lists repositories whose imports have completed.

The application itself reads only `GITHUB_TOKEN`; it does not call the GitHub CLI. On another machine, set that environment variable before starting the app. Never put a token in a `VITE_` variable or in the browser. If you use a fine-grained token, grant read access to Metadata, Contents, and Pull requests for the repositories you select. Organization repositories may require organization approval. Existing classic tokens must have access to the required private repositories.

## Production process

```bash
pnpm build
GITHUB_TOKEN="$(gh auth token)" pnpm start
```

Both development and production bind to `127.0.0.1:3000`. This is a personal local application without application login. Raspberry Pi deployment is not performed by this project. On the Pi, use a compatible 64-bit operating system and Node runtime, install from the lockfile, build, and run the same production command with `GITHUB_TOKEN` set. You can access its loopback listener from another machine with an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 your-user@your-pi
```

A private network listener or public hosting needs an explicit access-control decision before changing the binding. Hardware and operating-system compatibility have not been tested on a Pi.

## Storage and import behavior

- Data lives in `data/activity.sqlite`, outside the build output. Override the path with `HQ_DATABASE`. Database files and credentials are ignored by Git.
- Each repository is saved atomically after its import finishes. A failed import preserves its previous snapshot and all other completed repositories. Import status survives a restart; an interrupted import is reported as interrupted.
- Each import replaces the selected repositories' snapshots for the requested date range. Unselected repositories are untouched. Extending history means choosing an earlier import start date. Refreshes reuse details of previously saved immutable commits and re-read branch membership and merged requests.
- Imports run only when requested. At most one import runs per app process. Keep that process running while importing. Closing the browser does not stop an import. Run only one app process per database.
- API calls are paginated; commit detail reads use batches of four. Rate limits stop the import with a visible error. There are no automatic retries. Run the import again after the reported limit resets.
- The importer pins each default branch to its current commit before paginating. A repository that was renamed or becomes inaccessible must be selected under its current accessible name.
- Repository discovery lists repositories the token can access through ownership, collaboration, or organization membership. It does not claim to discover every public repository you have ever contributed to.
- Coverage is displayed per repository. Current-day totals stop at the import start time. The dashboard shows partial coverage when filters extend beyond imported dates.
- The database is tied to the importing GitHub account; importing another account into it is rejected.

To back up or move the database, stop the app first and copy the entire `data` directory, including SQLite sidecar files if present. Do not copy `node_modules` between machines.

## Date ranges and charts

The date toolbar provides 1W, 2W, 1M, 3M, 6M, and 1Y shortcuts. Weekly shortcuts include the Through date and cover exactly 7 or 14 UTC days. More opens 2–6 years and custom dates. The All projects control opens a secondary repository filter. Completed imports do not keep a banner on the dashboard. Choose 1, 3, or 6 months, or 1 through 6 years. Presets subtract calendar months from the Through date, clamping to the last valid day; custom dates remain available. Open Import activity after selecting a range to import from that start date. Changing a filter alone does not fetch older history.

Daily shows one total per UTC day. Cumulative line accumulates those daily totals within the selected dates. Both support commits, authored requests merged, requests merged by you, and line changes. The current day can be partial. Missing history is a gap, not zero activity; partial coverage is labeled. Chart controls persist in the URL. Metric buttons sit on the left and view buttons on the right above the graph. Select a day to open its records.

Languages defaults to a pie chart of additions plus deletions, with the top five file types and the remainder grouped together. Pie and Table buttons switch the view and persist in the URL. The table shows additions, deletions, commits touching each language, project counts, and share of changed lines for the selected dates and repositories. Classification uses file extensions and common filenames, not repository primary language or content detection. Documentation, configuration, lockfiles, and unknown file types are included. Merge commits are excluded. Multi-language commit counts overlap. Existing imports need a refresh to collect language details; missing details are reported and excluded from the language table.

## Counting contract

1. **Commits:** GitHub-attributed authored commits reachable on the imported default branch, within the selected UTC commit-date range. Merge commits count as commits. Unmerged branches, local-only commits, and commits GitHub does not associate with the account are excluded. Squashed history counts the resulting commits, not the original branch commits. The same work present in separate imported repositories counts in each repository.
2. **Lines added/deleted:** sum of GitHub's additions and deletions on non-merge commits. Merge-commit line changes are excluded to avoid counting merged changes twice. Repeated edits count repeatedly. These totals include generated files and dependency lockfiles; they do not measure net repository size or code quality.
3. **Categories:** filename/path heuristics for Code, Tests, Documentation, Configuration, Generated / dependencies, and Other. Generated paths and lockfiles take priority over other categories. Commit totals remain authoritative when GitHub file statistics are incomplete. Missing additions and deletions are recorded as Unclassified in categories and languages. If file totals exceed commit totals, the entire commit breakdown is Unclassified because it cannot be apportioned reliably. Imports continue; network and authentication failures still preserve the previous snapshot.
4. **Your requests merged:** pull requests authored by the importing account whose merge timestamps fall in the selected dates, regardless of who merged them. Requests targeting any branch are included.
5. **Merged by you:** merged pull requests where GitHub records the importing account as the merge actor, regardless of author. Authored and merged-by-you counts overlap; do not add them together. Bot-performed merges are attributed to the bot.
6. **Pull-request line changes:** displayed only on request records. They are never added to commit line totals.
7. **Active days:** unique UTC days containing an authored commit or a merged request authored by the importing account.
8. **Median merge time:** median elapsed time from opening to merging the account's authored requests merged in the selected dates, including draft time.

Source APIs: [commits](https://docs.github.com/en/rest/commits/commits), [repository access](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user), and [GraphQL pull requests](https://docs.github.com/en/graphql/reference).

## Development checks

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests cover UTC date boundaries, attribution, merge exclusion, category rules, snapshot replacement, account isolation, pagination, commit reuse, and failure preservation. Browser checks must use the running app with real GitHub data to verify the import workflow.

Server functions in `src/server/fns.ts` own the data boundary. Server-derived data belongs to Query. Shareable dates, repository, record type, page, and view belong to Router search parameters. Zustand owns the theme preference. Secrets and database imports stay on the server.

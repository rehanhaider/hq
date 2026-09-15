# HQ

Personal dashboard for planning and daily tracking. Content, Nasr, the 40-day practice tracker, and GitHub activity run in one TanStack Start process with three SQLite files. There is no login. The app listens on the house network.

## Application foundation and pages

Navigation has two levels. The left sidebar contains only Home and primary modules: Nasr, Content, and GitHub. Each module owns a horizontal page-navigation bar above its content. Module pages must not be flattened into the primary sidebar. The desktop sidebar collapses to an icon rail and remembers its state. Hover or keyboard focus previews the expanded rail without moving the content. Ctrl/Cmd+B toggles collapse outside text fields and editors. On phones, the sidebar opens as a dismissible drawer. A utility top bar holds the sidebar toggle; the appearance control sits at the foot of the sidebar; module tabs remain above the content.

TanStack Start is the application framework. Its Vite plugin builds the client and server, file-based Router routes own page navigation, and Start server functions own database access. The production command serves Start's generated server entry. There is no separate application framework or custom request router.

TanStack Query owns fetched data and mutations. TanStack Router owns shareable filters and pagination. TanStack Table owns repository table sorting. The existing theme store owns only the light/dark preference. The existing shared components and stylesheet own appearance.

- Home is the daily briefing, with practice progress, a link to continue logging, and a smaller weekly coding summary.
- Nasr contains Today, Progress, and Settings. Progress separates Salah from adhkar and other practices. Notes and daily note entry are removed. Charity logging is not part of the app and old charity records are not imported or exported.
- Content contains Pages, Board, Trash, and Settings. It is the production pipeline for streams, YouTube videos, blog posts, and architecture articles. Pages has a searchable nested page list beside a formatted editor on larger screens; on phones, the list and editor open one at a time. Every page — nested subpages included — is a content item with a status, an optional type, and any number of tags, and every page that is not in the trash appears on the Board. Content is separate from old Nasr daily-note data.
- GitHub contains Overview (`/github`), Statistics (`/github/statistics`), Work (`/github/work`), and Repositories (`/github/repositories`). Repositories manages imports and stored coverage. The date range and repository filter are search parameters shared by Overview and Statistics.

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
| Hotkeys | Keyboard shortcut management | Not added; the Content editor and app shell own their shortcuts |
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

Nasr's history was imported into `data/deen.sqlite` on 8 September 2026 and the Nasr install has been removed; the `imported_from` setting records where it came from. The one-shot importer has been deleted along with it, so a database restored from a Nasr backup would need importing by hand.

Override database paths with `HQ_DATABASE` (GitHub), `HQ_DEEN_DATABASE` (Nasr), and `HQ_CONTENT_DATABASE` (Content). All three default under `data/`. `HQ_NOTES_DATABASE` is the old name for the Content path; it still works and is deprecated. `HQ_UPLOADS_DIR` moves the files Content pages link to; it defaults to `data/uploads`.

The application itself reads only `GITHUB_TOKEN`; it does not call the GitHub CLI. Never put a token in a `VITE_` variable or in the browser. If you use a fine-grained token, grant read access to Metadata, Contents, and Pull requests for the repositories you select.

## Production process

```bash
pnpm build
GITHUB_TOKEN="$(gh auth token)" pnpm start
```

Development and production bind to `0.0.0.0:3000` so phones on the same network can open it. This is a house-network app with no application login. Do not put it on the public internet.

On a Raspberry Pi, install from the lockfile, build, and run the same production command.

`deploy/` holds the systemd units the Pi runs. Copy them to `/etc/systemd/system/`, then `systemctl enable --now hq.service hq-backup.timer`. `hq.service` binds port 80 so the app answers at `hq.local`, and grants only `CAP_NET_BIND_SERVICE` so it still runs as the app user rather than root. Put `GITHUB_TOKEN` in `.env` beside the lockfile; the unit reads it through `EnvironmentFile`.

After pulling or editing the source, run `make deploy` (`scripts/deploy.sh`). It installs from the lockfile, rebuilds `dist/`, and restarts `hq.service`; the running app does not pick up changes until then.

## Storage and import behavior

- GitHub data lives in `data/activity.sqlite`, Nasr data lives in `data/deen.sqlite`, Content data lives in `data/content.sqlite`, and Content's uploaded files live in `data/uploads/`. Override them with `HQ_DATABASE`, `HQ_DEEN_DATABASE`, `HQ_CONTENT_DATABASE` (or the deprecated `HQ_NOTES_DATABASE`), and `HQ_UPLOADS_DIR`. GitHub organisation pictures are a re-fetchable cache in `data/avatars/` (`HQ_AVATARS_DIR`), refreshed weekly and left out of the backups. Database files and credentials are ignored by Git. On start, a `data/notes.sqlite` left by the old Notes module is renamed to `data/content.sqlite`, write-ahead log included, and the rename is logged once; the `notes` table becomes `pages` in place.
- Content stores the full BlockNote JSON document in SQLite. This is the lossless source of truth. Images, videos, and files are not in it: they are written to `data/uploads/` (`HQ_UPLOADS_DIR`), named by the SHA-256 of their own bytes plus the file extension, and the `uploads` table records the name, type, size, and page for each one. The same file attached twice is stored once. A file is at most 25 MB and has to be an image, a video, a PDF, an Office or text document, JSON, or a zip; anything else is refused with the reason shown under the editor. `/api/uploads/<id>` serves a stored file with its own type and a year of immutable caching, because the name is the content. Pages move to Trash with their active descendants and can be restored, files included — only deleting a page from the Trash removes rows and unlinks the files no other page still uses. A revision check rejects an older browser tab rather than overwriting a newer save.
- GitHub Repositories (`/github/repositories`) is the repository list: add, remove, fetch status, and stored counts (commits, merged requests, line changes). Filter by organization. Sorted by commit count. Overview and Statistics show activity.
- After the first import, HQ refreshes already-imported repositories in the background. Opening the app starts a catch-up if the last run is older than 15 minutes (`HQ_REFRESH_MS`, `0` to disable). Each refresh asks GitHub only for the last 48 hours, then merges new commits and pull requests into the saved snapshot so older history stays put.
- Open work (the Overview lists and the Work view) is a live GitHub search sweep, not part of the import. The last result is saved in `data/activity.sqlite` and served immediately; a new sweep runs in the background when that copy is older than five minutes, and the same background tick that runs refreshes keeps it warm. The GitHub page never waits on the sweep: Overview shows its statistics first and fills the work lists when they arrive.
- Add or remove repositories from Repositories. Removing a repository deletes that repository’s stored history from HQ. Pick an earlier start date only to reach before the earliest saved day. Manual import merges into what is already stored. Unselected repositories are untouched. A repository that fails to fetch is marked failed and the rest continue; token, network, and rate-limit errors stop the run. A dropped connection or a 5xx from GitHub is retried three times with a short back-off first, and the status names the underlying cause (for example `ECONNRESET` or `no response within 60s`), which is also written to the journal.
- Each repository is saved atomically after its import or refresh finishes. A failed run preserves its previous snapshot and all other completed repositories. Status survives a restart. A manual import cut off by a restart is reported as interrupted; a background refresh cut off the same way is not an error — nothing was lost, so it is quietly rescheduled and starts again within a minute.
- Refreshes reuse details of previously saved immutable commits and re-read recent branch membership and merged requests. At most one import or refresh runs per app process. Keep that process running. Closing the browser does not stop a run. Run only one app process per database.
- API calls are paginated; commit detail reads use batches of four. Rate limits stop the run with a visible error. There are no automatic retries. The next scheduled refresh tries again after the reported limit resets.
- The importer pins each default branch to its current commit before paginating. A repository that was renamed or becomes inaccessible must be selected under its current accessible name.
- Repository discovery lists repositories the token can access through ownership, collaboration, or organization membership. It does not claim to discover every public repository you have ever contributed to.
- Current-day totals stop at the last successful refresh.
- The GitHub database is tied to the importing GitHub account; importing another account into it is rejected.

To back up or move the databases, stop the app first and copy the entire `data` directory, including SQLite sidecar files if present. Do not copy `node_modules` between machines.

`hq-backup.timer` runs `scripts/backup.mjs` daily at 02:00 and keeps 7 daily and 4 weekly copies of every database under `backups/<database>/<tier>/`, which Git ignores. It backs up the paths `HQ_DEEN_DATABASE`, `HQ_DATABASE`, and `HQ_CONTENT_DATABASE` (or the deprecated `HQ_NOTES_DATABASE`) resolve to, along with the uploads directory `HQ_UPLOADS_DIR` resolves to, not whatever happens to sit in `data/`, so a relocated database is still covered, and a path named by any of those variables that does not exist fails the run rather than being skipped quietly. `hq-backup.service` therefore reads the same `EnvironmentFile` as `hq.service`. Any other `.sqlite` beside them is picked up too. Each database gets its own directory, so retention and weekly scheduling for one can never affect another; two databases sharing a filename would share a directory, so that is refused with an error naming both paths rather than resolved by guessing a name. A database named `uploads` is refused too: that directory is reserved for the uploaded-file copies.

It uses `VACUUM INTO` rather than a file copy: copying a WAL-mode database captures only the main file and silently omits everything still in the `-wal`, which is how Nasr's old timer ended up a week stale. Each snapshot is staged under a `.tmp` name, reopened and `PRAGMA integrity_check`ed, and only renamed into place once it passes, so a file carrying the `.sqlite` name is always one that was verified — a run killed mid-write leaves nothing that retention or the weekly check would mistake for a good backup. Pruning is by count, so a long gap in runs cannot delete every backup. The weekly tier fires per database whenever that database's newest weekly copy is seven calendar days old, rather than on a fixed weekday, so a Pi that is off on Sundays still gets one and a database whose weekly copy failed is retried. Calendar days rather than a strict 168 hours, because the timer's jitter would otherwise let the seventh day fall minutes short and stretch the interval to eight. Runs are serialised by a kernel advisory lock: the script re-executes itself under `flock`, so an ad-hoc backup started while the timer is running exits rather than racing it for the same weekly slot, however it was invoked. The kernel releases the lock when the holder dies, so there is no stale lock to detect or recover — a leftover `backups/.lock` is inert. Without `flock` on the system the script says so and runs unlocked rather than not running at all. Uploaded files cannot be vacuumed, so the uploads directory is copied whole into `backups/uploads/<tier>/uploads-<stamp>/` under the same tiers and the same retention — staged under a name nothing counts and renamed into place once the copy finishes, so a half-written copy is never mistaken for a good one. A page restored without its pictures is only half a restore, which is why they are not left to the database backup. Run `node scripts/backup.mjs` for an ad-hoc snapshot, or set `HQ_BACKUP_WEEKLY=1` to force the weekly tier.

## Content editor

Use the formatting toolbar or type `/` to insert headings, lists, checklists, quotes, code blocks, tables, images, videos, and files. Blocks can be dragged by their handle. Markdown shortcuts such as `# ` for a heading work at the start of a block.

Paste or drop an image, a video, or a file onto a page, or insert an empty block and choose one. It uploads to the page it was dropped on and the block keeps BlockNote's own resize handle and caption. Audio blocks are not available. A refused file — too large, or a type HQ does not store — says so under the editor and leaves the page alone.

Under the page title sits the property bar: status, type, and tags. Property changes save on their own, immediately, and never touch the document or its revision, so an open editor keeps its unsaved text.

- Ctrl/Cmd+B: bold
- Ctrl/Cmd+I: italic
- Ctrl/Cmd+U: underline
- Ctrl/Cmd+K: insert or edit a link
- Ctrl/Cmd+Z: undo
- Ctrl/Cmd+Shift+Z: redo

Pages save after a short pause. The page shows Unsaved, Saving, Saved, or Save failed. Navigation waits for an unsaved page; retry keeps the local document in the editor. If another tab has already saved a newer revision, overwriting it requires a separate explicit action.

## Content board and properties

Board draws one column per status, in the order Settings gives them. Cards show the title, the type and tags as coloured chips, when the page was last updated, and the parent page when it is nested. Clicking a card opens it in Pages. Dragging a card to another column sets that property; dragging within a column saves a manual order. `+ New` at the foot of a column creates a page already in that column and opens it. Group by switches the columns between Status, Type, and Tag, with "No type" and "Untagged" buckets for pages that have neither; dragging across those columns sets the type or adds and removes the tag. Drag and drop uses `@dnd-kit`.

Filters — status, type, tag, and a title search — and the sort (Manual, Updated, Created, Title) live in the URL, so a filtered board is a link. They apply to the Pages list as well. Clear removes them.

Settings owns the three property lists. Add, rename in place, recolour from a fixed palette, reorder, and delete. Deleting a status that holds pages asks which status they move to; deleting a type clears it from its pages; deleting a tag drops its links. The last status cannot be deleted, because the board needs a column. A new page starts in the first status with no type and no tags, and a new subpage inherits its parent's type.

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

Tests cover UTC date boundaries, attribution, merge exclusion, category rules, snapshot replacement, account isolation, pagination, commit reuse, failure preservation, deen rolling-window dates, streaks, adherence, Content data safety and validation, property migration and seeding, board moves, filters and sorts, upload limits and deduplication, permanent deletion of a page's files, copies of those files on other pages, a write that cannot record a page, a blank uploads path, the zip types Windows sends, an upload still in flight when leaving the page, and backup rotation.

Server functions in `src/server/fns.ts` own the data boundary. Server-derived data belongs to Query. Shareable dates, repository, record type, page, Content search, filters, sort, grouping, and view belong to Router search parameters. Zustand owns the theme preference. Secrets and database imports stay on the server.

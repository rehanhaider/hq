# HQ UI proposal

A design proposal, not a redesign. Audited on 13 September 2026 against the
running app at 1440px and 440px, light and dark, with the Content database
seeded so the populated states could be seen. Screenshots referenced below were
taken from `/`, `/nasr`, `/nasr/history`, `/nasr/settings`, `/content`,
`/content/board`, `/content/trash`, `/content/settings`, and `/github` in its
three views.

---

## 1. Diagnosis

| # | Problem | Where | What the screenshot shows |
| --- | --- | --- | --- |
| 1 | **The homepage predates most of the app.** Its last commit is `cfd504d feat: better UI` — before Notes (`d9a2e50`), before Notes became Content (`45ed569`), before media (`f550488`). Six feature commits have landed since. | `src/routes/index.tsx` | Two modules only: a copy of Nasr Today and a 3-line GitHub summary. Content — the module the app is now mostly about — does not appear at all. |
| 2 | **Four different container styles compete inside one app**, often on one screen: bordered panel (`.panel`), hairline-divided section (`.hairline`), bordered card grid, and plain borderless stack. | `app.css` `.panel`/`.hairline`, `Dashboard.tsx`, `nasr/settings.tsx`, `ContentSettings.tsx` | Nasr Settings puts a bordered form on the left and a borderless list on the right. GitHub Overview stacks a bordered chart card between two borderless hairline sections. |
| 3 | **Every route repeats its own name three times.** The breadcrumb says it, the view dropdown says it, then `.page-title` says it again 60px lower at 32px. | `.page-header`/`.page-title` in `app.css`, used by 8 routes | Board: top bar reads `HQ › Content › Board ⌄`, then a 32px "Board" heading, then a sentence of description, then a filter row — 215px of chrome before the first card at 1440px, 290px of 814px at 440px. |
| 4 | **The module tab bar specified in the README was never rendered.** `.section-tabs` / `.section-tab` exist in `app.css` and are referenced nowhere in `src/`; module views hide inside a breadcrumb dropdown instead. | `app.css:166-176`, `Breadcrumbs.tsx` `ViewSwitcher` | Switching from Pages to Board needs a click into a chevron menu. Sibling views are invisible until you open it. |
| 5 | **Pages are ~40% full at 1440px.** Layouts are two fixed columns with a short right rail and nothing below. | `routes/index.tsx`, `nasr/index.tsx`, `nasr/history.tsx`, `ContentBoard.tsx` | Home: content stops at y≈700 of 914; the right column stops at y≈424. Board: columns end at y≈515, leaving 400px of empty page. Nasr Progress ends at y≈630. |
| 6 | **Dark mode has almost no surface separation.** `--background: oklch(0.17)` vs `--card: oklch(0.205)` is a 0.035 lightness step, and `--sidebar` is literally `var(--card)`. | `app.css` `[data-theme="dark"]` | Dark board: the columns are visible only by their 1px border; the sidebar does not separate from the content area at all. |
| 7 | **Property colours are outside the design system.** Nine raw Tailwind hues (`slate blue teal green amber orange red pink violet`) at `-500`/`-600`, unrelated to the oklch tokens. | `src/components/content/properties.tsx` | Content Settings shows eight saturated dots in one column; a board card can carry violet + red + blue chips at once. Colour carries no meaning, only identity. |
| 8 | **Three date formats inside the GitHub module.** | `ActivityFilters.tsx`, `Dashboard.tsx` `HistoryList`, `Connections.tsx` | Toolbar: `13 Jun 2026 – 13 Sept 2026`. History row: `2026-09-12 18:44 UTC`. Repositories table: `13 Sept 2026, 12:41`. |
| 9 | **Three control idioms and two table implementations in the GitHub module.** Segmented pills, a custom checkbox combobox, and bare native `<select>`s; plus a hand-rolled `<table>` on Overview and `DataTable` on Repositories with different header, border and hover styling. | `ActivityFilters.tsx`, `Dashboard.tsx` `Projects`/`HistoryList`, `DataTable.tsx`, `Connections.tsx` | Activity history shows a pill group, a combobox and a native select on one screen. Repositories has a grey header row and a Remove action; Most active has a `border-y` header and none. |
| 10 | **Mobile breaks in three specific places**, not generally. | `ContentEditor.tsx`/`app.css` `.content-page-body`, `Dashboard.tsx` `Overview`, `ContentBoard.tsx` | 440px editor: the page title clips at the card edge mid-word. 440px GitHub: the 4 metrics break 2-then-1 ragged and the chart collapses to ~80px with no axis. Board: the horizontal scroller renders a **full-width white slab** in dark mode (no `color-scheme` on the scroller). |
| 11 | **Button scale is too fine to read as a system.** `xs 24px / sm 28px / default 32px / lg 36px` — four sizes inside 12px — plus a 44px coarse-pointer override that only applies to some of them. | `src/components/ui/button.tsx` | Content Settings rows carry three 16px icon buttons each; the dimmed reorder arrows read as broken rather than disabled. |
| 12 | **Dead routes ship.** `/notes/index` and `/notes/trash` are 4-line `component: () => null` stubs unreachable behind the parent redirect. | `src/routes/notes/index.tsx`, `src/routes/notes/trash.tsx` | — |

---

## 2. Homepage

### What it shows now, and why it doesn't make sense

| Shows | Problem |
| --- | --- |
| Date + "Your day at a glance" + "Today's practices and your week in code." | A 32px title and a subtitle that restate the two sections below them. |
| **Nasr today** — 5 salah rows, 4 practice checkboxes, istighfar count, Fajr streak | A near-exact copy of `/nasr`, one click away, except read-only. Nothing here can be done; every row is a link to do it elsewhere. |
| **This week in code** — commits, requests merged, "Repositories imported 92" | "Repositories imported" is a configuration fact, not activity. No trend, no shape, no sparkline — three numbers with no denominator. |
| *(nothing)* | **Content is absent.** The pipeline the app exists to run — 8 statuses, a board, a trash, an editor — has no presence on the home screen. |
| *(nothing)* | No cycle position (`cycleDay` is fetched and shown only as an eyebrow), no adherence, no quick action other than "Continue today's practice". |

It is a daily briefing for the app as it was three feature commits ago.

### Proposed homepage

Five modules, ordered by how often the owner acts on them. Everything is either
a number with a shape behind it, or a thing you can click to do work.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SUNDAY 13 SEPTEMBER                                          Day 12 of 40   │  greeting strip
│  Two prayers logged, three to go.                                            │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐  ┌──────────────────────────────────┐
│ TODAY                     2 / 5      │  │ THE CYCLE                        │
│                                      │  │                                  │
│  Fajr   Dhuhr  Asr   Magh   Isha     │  │        ╭───────╮                 │
│   ○      ◐     ●      ○      ○       │  │        │  68%  │  adherence      │
│  ──────────────────────────────────  │  │        ╰───────╯  day 12 of 40   │
│  ✓ Morning adhkar   ○ Evening        │  │                                  │
│  ○ Night recitation ○ Self-ruqyah    │  │  ▪▪▪▪▫▪▪▪▪▫▪▪ ▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫  │
│  ──────────────────────────────────  │  │  40-day strip, one mark per day  │
│  Istighfar  ▓▓▓▓▓░░░░░░░  42 / 100   │  │                                  │
│                                      │  │  Fajr streak      4 days         │
│  [ Log today  → ]                    │  │  Best             11 days        │
└──────────────────────────────────────┘  └──────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ IN FLIGHT                                                    9 pages · Board→│
│  Idea 3   Planned 1   Drafting 2   Recorded 1   Editing 1   Scheduled 1      │
│  ──────────────────────────────────────────────────────────────────────────  │
│  Building a Kanban board with dnd-kit     YouTube video · Drafting     1h ago │
│  Why I moved off Notion for planning      Blog post · Editing          1d ago │
│  SQLite WAL backups that actually restore Architecture · Recorded      4d ago │
│  Live: refactoring the import pipeline    Stream · Scheduled           1h ago │
│  ──────────────────────────────────────────────────────────────────────────  │
│  [ + New page ]                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ LAST 7 DAYS IN CODE                                            Open GitHub → │
│  77 commits      30 requests merged      +12,431 / −3,180 lines              │
│  ▁▃▂▅█▂▁  one bar per day, Mon→Sun                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

At 440px the four cards stack in the same order; the cycle ring sits beside the
40-day strip rather than above it, and the In-flight list truncates to three rows.

### Data each module needs

| Module | Source | Available today? |
| --- | --- | --- |
| Greeting strip | `homeQuery` → `nasr.today`, `nasr.cycleDay`, `nasr.day` | Yes |
| Today | `homeQuery` → `nasr.day` (5 salah, 4 practices, `istighfar_count`), `nasr.settings.istighfar_target` | Yes |
| The cycle | `homeQuery` → `nasr.adherence` / `nasr.overall`, `nasr.days` (the 40 marks), `nasr.cycleDay`, `nasr.fajrStreak` | Yes — `getHome` already returns all of it and the page throws it away |
| In flight | `pagesQuery()` + `contentPropertiesQuery` from `src/queries/content.ts`, or better: extend `getHome` with `content: { counts, recent }` from `getContentStore().list()` | **Needs a small server change** (`src/server/fns.ts` `getHome`) |
| Last 7 days in code | `homeQuery` → `github.week.total` plus `week.daily`, which `summarize()` already computes and `getHome` discards | **Needs one line** — return `week` instead of `week.total` |

So the homepage costs one small change to `getHome` and no new queries.

---

## 3. Visual system

### Palette options

Each value is what the corresponding CSS variable in `src/styles/app.css`
should resolve to. `surface-2` is new: the third step the current two-step
system is missing (it is what makes the sidebar read as chrome and dark cards
read as cards).

**Option A — Warm paper, evergreen** *(recommended)*

| Token | Light | Dark |
| --- | --- | --- |
| background | `#FAF9F6` | `#131311` |
| surface (card) | `#FFFFFF` | `#1C1C19` |
| surface-2 (sidebar, wells) | `#F3F2EE` | `#242421` |
| border | `#E4E2DC` | `#34342F` |
| foreground | `#1C1B19` | `#EDECE8` |
| muted foreground | `#6B6862` | `#9C9A93` |
| accent | `#15694E` | `#58C39A` |
| positive | `#1E7A4E` | `#4FBF8B` |
| negative | `#B3412C` | `#E0765C` |

**Option B — Slate ink, indigo**

| Token | Light | Dark |
| --- | --- | --- |
| background | `#F6F7F9` | `#0E1116` |
| surface | `#FFFFFF` | `#171B22` |
| surface-2 | `#EEF0F4` | `#1F252E` |
| border | `#DDE1E8` | `#2B323D` |
| foreground | `#14181F` | `#E7EAEF` |
| muted foreground | `#626B7A` | `#939CAA` |
| accent | `#3A5BD9` | `#7C9AFF` |
| positive | `#13795A` | `#45C48C` |
| negative | `#C0392F` | `#F0796B` |

**Option C — Graphite, amber**

| Token | Light | Dark |
| --- | --- | --- |
| background | `#FFFFFF` | `#0B0B0A` |
| surface | `#FAFAF9` | `#151514` |
| surface-2 | `#F2F1EF` | `#1E1E1C` |
| border | `#E3E2DF` | `#2D2D2A` |
| foreground | `#0C0C0B` | `#F5F4F1` |
| muted foreground | `#6E6D69` | `#A1A09B` |
| accent | `#B45309` | `#F0A42B` |
| positive | `#15803D` | `#4ADE80` |
| negative | `#B91C1C` | `#F87171` |

**Recommendation: A.** The app's problem is not its hue — warm paper and
evergreen are already its identity, in the favicon and in Geist's warmth — it is
that the system has only two surface steps, a dark mode whose steps are 0.035
apart, and no accent doing any work below the level of a primary button. A
re-hue would churn every file and fix none of that. A keeps the identity, adds
the missing third surface, widens the dark steps to ~0.05, and darkens the light
accent so it can be used for text and rules, not only on a filled button. B is
the fallback if the owner wants HQ to stop looking like a note-taking app; C is
too high-contrast for something looked at every morning.

### Type scale

Geist for text, Geist Mono for every figure.

| Role | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| Display (one per page, max) | 40 / 1.05 | 600 | tabular mono, `-0.02em` |
| Page / card title | 24 / 1.2 | 600 | down from today's 32/`2rem` |
| Section title | 15 / 1.3 | 600 | |
| Body | 14 / 1.5 | 400 | |
| Small / meta | 13 / 1.45 | 400 | muted |
| Eyebrow label | 11 / 1 | 500 | uppercase, `+0.06em`, muted |
| Figure (inline) | 20 / 1.1 | 600 | mono, tabular |

Today a page title (32px) is larger than any number on the page. That inverts
the hierarchy: on a dashboard the data is the headline.

### Spacing, radius, shadow

- **Spacing:** 4px base, and only `4 · 8 · 12 · 16 · 24 · 32 · 48`. Section gap
  32 desktop / 24 mobile. Card padding 16 compact, 20 default — never mixed on
  one page. (Today the same page uses `gap-5`, `gap-6`, `gap-8`, `gap-10`,
  `gap-12`, `mt-2.5`, `mt-1.5`, `py-2.5`.)
- **Radius:** one `--radius: 10px`. Card 12, control 8, chip 6, dot full. Delete
  the six derived `--radius-*` steps; nothing needs `2.6 × radius`.
- **Shadow:** exactly two. `0 1px 2px rgb(0 0 0 / .04)` on raised cards, light
  theme only; `0 8px 24px rgb(0 0 0 / .16)` on popovers and drawers. Dark mode
  separates with lightness, never shadow.
- **Controls:** three heights only — 28 (compact/toolbar), 32 (default), 40
  (primary action and every touch target). Drop `xs` and `lg`.

### Borders versus surfaces

**Surfaces carry grouping; borders mark only what is interactive or scrollable.**

- A page is *either* sectioned (no boxes; an eyebrow label + 32px of air) *or*
  carded (boxes) — never both, which is what Nasr Settings and GitHub Overview
  do today.
- Use a **card** when the content is draggable, scrollable, editable, or an
  independent unit of work: board columns, the editor, the homepage modules.
- Use a **section** when the content is read in place: metric rows, adherence
  bars, language tables.
- In light mode a card is `surface` + 1px `border`. In dark mode a card is
  `surface` with **no** border — the lightness step does the work. That single
  rule removes most of the grey-on-grey.

---

## 4. Per-area recommendations

### Shell / sidebar — `src/components/Shell.tsx`, `src/components/Breadcrumbs.tsx`

1. Give the sidebar `surface-2` instead of `var(--card)` so chrome and content
   are distinguishable, in dark mode especially.
2. **Render the module tab bar the README specifies.** `.section-tabs` /
   `.section-tab` already exist in `app.css` and are used nowhere. Put the views
   (Today · Progress · Settings; Pages · Board · Trash · Settings; Overview ·
   History · Repositories) in a tab row under the top bar, and delete
   `ViewSwitcher` from the breadcrumb.
3. **Delete `.page-title` / `.page-description` from any route that has a
   crumb** (8 routes). Replace with a single 40px action row: page actions on
   the right, nothing on the left. This is the single biggest density win —
   215px of chrome at 1440px, 290px at 440px.
4. Put the theme toggle in a small overflow menu and give the top bar something
   to do: a global search / "New page" entry point. Today it is a toggle, a
   breadcrumb, and 900px of nothing.
5. Show a count beside each nav item (pages in flight, salah `n/5`) — five items
   occupy 5% of a 950px rail.

### Content — `src/components/content/*`

1. **Merge the Pages header into the workspace.** When a page is open — which is
   the normal state — "Pages", its description, the New-page button and the
   filter row sit above the editor and duplicate the crumb. Move filters into
   the list column head and the New-page button into the list head.
2. **Fix the 440px title overflow** in `ContentEditor` / `.content-page-body`:
   the title clips mid-word at the card edge. Needs `min-w-0` and a smaller
   `padding-inline` at that width.
3. **Board columns:** stretch to equal height, default to `columns=filled` (the
   switch already exists) so 8 statuses don't leave four empty 170px stubs, and
   move the status colour into the column header rather than an 8px dot.
4. **Board scroller:** set `color-scheme` / `scrollbar-color` on the overflow
   container — in dark mode it currently paints a full-width white slab under
   the columns.
5. **Chips:** replace the nine raw Tailwind hues in `properties.tsx` with six
   token-derived pairs, and cap a card at two chips plus `+n`.
6. **Settings rows:** replace the three 16px icon buttons per row with a drag
   handle and one overflow menu; the dimmed arrows currently read as broken.

### Nasr — `src/routes/nasr/*`

1. **Today:** the Istighfar panel is the only bordered box on the page. Commit:
   three equal cards (Salah, Practices, Istighfar) with identical padding.
2. Move the 40-day strip and the streak into the empty right column — it is
   blank below y≈420 of 914.
3. **Progress:** `6 % of days` splits the number from its unit badly, and the
   two metrics use two different type sizes on two baselines. Use one row of
   three equal metric tiles with the new figure style.
4. **Progress bars:** 13 bars at 4px in two columns is a texture, not a chart.
   One row per practice, value first, `positive` token rather than `primary`.
5. **Settings:** the left form is a bordered panel and the right list is
   borderless. Same page, same treatment.

### GitHub — `src/components/Dashboard.tsx`, `ActivityFilters.tsx`, `ActivityChart.tsx`, `Connections.tsx`, `LanguageMetrics.tsx`

1. **One table.** Keep `DataTable`; port `Dashboard.Projects` onto it. Drop the
   "TypeScript · Private" sub-line repeated identically on every row into a
   column.
2. **One date format.** Add a single formatter in `src/lib/activity.ts` and use
   it in the toolbar, the history rows and the repositories table.
3. **One control idiom.** Replace the two bare native `<select>`s (record type,
   organization filter) with the same component as the repository combobox.
4. **Chart:** rounded gridline values, a 1px baseline, a hover read-out, and a
   minimum height at 440px — it currently collapses to ~80px with no axis and
   1px bars.
5. **Metric row:** 2×2 at 440px instead of the ragged 2-then-1, with mono
   tabular figures.
6. **Repositories:** 92 unpaginated rows (7,049px tall at 440px). Page it, and
   drop the "Connected" column that holds one value in 91 of 92 rows.

---

## 5. Phased plan

### Phase 1 — tokens, shell, homepage *(≈1 day, one small PR)*

The whole-app win. Nothing here touches Content or GitHub logic.

| File | Change |
| --- | --- |
| `src/styles/app.css` | Palette A incl. `--surface-2`; type scale; spacing/radius/shadow rules; `.card` + `.section` classes; retire `.panel`, `.hairline`, `.display-unit`; `color-scheme` on scrollers |
| `src/components/Shell.tsx` | Sidebar surface, module tab row, top-bar actions |
| `src/components/Breadcrumbs.tsx` | Remove `ViewSwitcher` |
| `src/routes/index.tsx` | Rebuild as the five modules above |
| `src/server/fns.ts` | `getHome`: return `week` (for the sparkline) and add `content: { counts, recent }` |
| 8 route/component files | Delete `.page-header` / `.page-title` / `.page-description` blocks |
| `src/routes/notes/index.tsx`, `notes/trash.tsx` | Delete (unreachable stubs) |

### Phase 2 — Content *(≈1–1.5 days)*

| File | Change |
| --- | --- |
| `ContentWorkspace.tsx` | Header merge, filters into the list head |
| `ContentEditor.tsx` + `app.css` | 440px title overflow, editor chrome |
| `ContentBoard.tsx` | Equal-height columns, filled-by-default, header colour, scrollbar |
| `properties.tsx` | Token chip palette, chip cap |
| `ContentSettings.tsx` | Row controls → handle + overflow menu |
| `ContentTrash.tsx` | Header + empty state |

### Phase 3 — GitHub and Nasr *(≈1–1.5 days)*

| File | Change |
| --- | --- |
| `Dashboard.tsx` | `Projects` onto `DataTable`, metric row grid, section/card discipline |
| `ActivityFilters.tsx` | Unified controls, one date format |
| `ActivityChart.tsx` | Axis, gridlines, tooltip, responsive minimum |
| `Connections.tsx` | Paging, drop the constant column |
| `LanguageMetrics.tsx` | Chart colours from tokens |
| `nasr/index.tsx`, `nasr/history.tsx`, `nasr/settings.tsx` | Card discipline, metric tiles, bar treatment |

Total: roughly three to four days of work, with the visible half of it in Phase 1.

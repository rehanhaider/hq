import { Fragment, useMemo, useState } from "react";
import { Chart } from "@tanstack/charts/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FilePlus2,
} from "lucide-react";
import { homeQuery, nasrKeys } from "@/queries/nasr";
import { openWorkSummaryQuery } from "@/queries/dashboard";
import { age, repoName } from "@/lib/openWork";
import { attentionStatus, isStale, reasonLabel } from "@/lib/attention";
import { useNewPage } from "@/queries/content";
import { getCachedOpenWorkSummary, updateNasrDay } from "@/server/fns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Dot } from "@/components/content/properties";
import { contentStatus, isQuiet, relativeTime } from "@/lib/content";
import {
  PRACTICE_KEYS,
  SALAH_KEYS,
  emptyDaysNote,
  groupAdherence,
  markLabel,
  middayPrayerLabel,
  nasrStatus,
  practiceProgress,
  unloggedDays,
  windowStrip,
  windowSummary,
  withDay,
  type PrayerStatus,
  type StatusSegment,
} from "@/lib/nasr";
import { defaultFilters } from "@/lib/model";
import { weekChart } from "@/lib/charts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(homeQuery),
      seedOpenWork(context.queryClient),
    ]);
  },
  component: HomePage,
});

/**
 * Open work renders with the rest of Home when a saved feed exists. Without
 * one the card fetches on its own after the page lands, so a cold GitHub
 * sweep never holds Home up.
 */
async function seedOpenWork(queryClient: QueryClient) {
  if (queryClient.getQueryData(openWorkSummaryQuery.queryKey)) return;
  const saved = await getCachedOpenWorkSummary();
  if (saved) queryClient.setQueryData(openWorkSummaryQuery.queryKey, saved);
}

type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
type LoggedStatus = "ontime" | "qada";

function number(value: number) {
  return value.toLocaleString("en-GB");
}

function Rule() {
  return <div className="my-4 h-px bg-border" />;
}

function HomePage() {
  const queryClient = useQueryClient();
  const home = useQuery(homeQuery);
  const work = useQuery(openWorkSummaryQuery);
  const newPage = useNewPage();
  const [creating, setCreating] = useState(false);
  const logPrayer = useMutation({
    mutationFn: ({ date, key, status }: { date: string; key: PrayerKey; status: LoggedStatus }) =>
      updateNasrDay({ data: { date, [key]: status } }),
    onMutate: async ({ key, status }) => {
      await queryClient.cancelQueries({ queryKey: nasrKeys.home });
      const previous = queryClient.getQueryData(homeQuery.queryKey);
      queryClient.setQueryData(homeQuery.queryKey, (current) => {
        if (!current) return current;
        const { nasr } = current;
        const day = { ...nasr.day, [key]: status };
        // The 40-day strip and its figures read `days`, not `day`, so they
        // are rebuilt here too. Otherwise they wait on the refetch, which
        // also carries the GitHub summary and can land well after the tap.
        const days = withDay(nasr.days, day);
        return {
          ...current,
          nasr: {
            ...nasr,
            day,
            days,
            ...windowSummary(days, nasr.today, nasr.settings.istighfar_target),
          },
        };
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(homeQuery.queryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: nasrKeys.all });
      void queryClient.invalidateQueries({ queryKey: nasrKeys.home });
    },
  });
  if (home.isPending)
    return (
      <div
        className="h-80 animate-pulse rounded-xl bg-muted"
        aria-label="Loading your day"
      />
    );
  if (!home.data)
    return (
      <div role="alert">
        <p>Your day could not load.</p>
        <Button onClick={() => void home.refetch()}>Reload</Button>
      </div>
    );
  const { nasr, github, content } = home.data;
  const day = nasr.day;
  const prayers = [
    ["fajr", "Fajr", day.fajr],
    ["dhuhr", middayPrayerLabel(nasr.today), day.dhuhr],
    ["asr", "Asr", day.asr],
    ["maghrib", "Maghrib", day.maghrib],
    ["isha", "Isha", day.isha],
  ] as const;
  const logged = prayers.filter(([, , status]) => status !== null).length;
  const nextPrayer = prayers.find(([, , status]) => status === null);
  const practices = practiceProgress(day, nasr.content);
  const date = new Date(`${nasr.today}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const statusLine = [
    ...nasrStatus(day, nasr.days, nasr.today),
    ...attentionStatus(work.data),
    ...contentStatus(content),
  ];
  const target = nasr.settings.istighfar_target;
  const istighfar = target > 0 ? Math.min(100, (day.istighfar_count / target) * 100) : 0;
  const marks = windowStrip(nasr.days, nasr.today);
  const emptyDays = emptyDaysNote(unloggedDays(nasr.days, nasr.today));
  // From `adherence` rather than a server field, so a prayer logged on this
  // card moves them along with the strip.
  const figures = [
    ["Fajr on time", nasr.adherence.fajr_ontime?.percentage ?? 0],
    ["Salah prayed", groupAdherence(nasr.adherence, SALAH_KEYS).percentage],
    ["Practices", groupAdherence(nasr.adherence, PRACTICE_KEYS).percentage],
  ] as const;
  const week = github.week;
  // The bars count requests merged, not commits: the headline figures already
  // carry the commits, and a merged request is the unit of finished work.
  const peak = Math.max(...week.days.map((entry) => entry.prs), 0);
  const chart = github.repositories > 0;
  const quiet = content.lastEditedAt !== null && isQuiet(content.lastEditedAt);

  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="min-w-0">
        <p className="section-label">{date}</p>
        {/* The day in one line. Each part links to the card that holds it:
            on a phone the cards stack, and this line is what shows before
            the first scroll. */}
        <h1 className="mt-2 text-[1.0625rem] leading-normal font-medium tracking-[-0.01em] text-muted-foreground lg:text-[1.25rem]">
          {statusLine.map((segment, index) => (
            <Fragment key={segment.id}>
              {index > 0 && (
                <>
                  <span aria-hidden className="mx-2 sm:mx-2.5">
                    ·
                  </span>
                  <wbr />
                </>
              )}
              <StatusLink segment={segment} />
            </Fragment>
          ))}
        </h1>
      </header>

      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
        <section
          id="nasr"
          className="card flex scroll-mt-16 flex-col p-5"
          aria-labelledby="nasr-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="nasr-heading" className="section-title">
              Nasr
            </h2>
            <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">
              {logged} / 5 salah
            </span>
          </div>

          <ul className="mt-4 grid grid-cols-5 gap-2" aria-label="Today's prayers">
            {prayers.map(([, label, status]) => (
              <li key={label} className="text-center">
                <span
                  aria-hidden
                  title={`${label} — ${statusLabel(status)}`}
                  className={cn(
                    "block h-1.5 rounded-full",
                    status === "ontime"
                      ? "bg-positive"
                      : status === "qada"
                        ? "bg-warning"
                        : status === "missed"
                          ? "bg-negative"
                          : "bg-track",
                  )}
                />
                <span className="mt-2 block text-xs text-muted-foreground">
                  {label}
                </span>
                <span className="sr-only">{statusLabel(status)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-lg bg-muted/70 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">
                {nextPrayer ? `Log ${nextPrayer[1]}` : "All prayers logged"}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                {nextPrayer
                  ? "One click logs on time. Open the menu for qada."
                  : "Today's salah is complete"}
              </p>
            </div>
            <div className="flex shrink-0" role="group" aria-label="Log prayer">
              <Button
                type="button"
                className="w-16 rounded-r-none"
                disabled={!nextPrayer || logPrayer.isPending}
                aria-label={
                  nextPrayer ? `Log ${nextPrayer[1]} as on time` : undefined
                }
                onClick={() => {
                  if (!nextPrayer) return;
                  logPrayer.mutate({
                    date: nasr.today,
                    key: nextPrayer[0],
                    status: "ontime",
                  });
                }}
              >
                {nextPrayer ? "Log" : "Done"}
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon"
                      className="rounded-l-none border-l border-primary-foreground/20 -ml-px max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      disabled={!nextPrayer || logPrayer.isPending}
                      aria-label={
                        nextPrayer
                          ? `Choose how to log ${nextPrayer[1]}`
                          : "Choose how to log"
                      }
                    >
                      <ChevronDown />
                    </Button>
                  }
                />
                <MenuContent align="end" className="min-w-36">
                  <MenuItem
                    onClick={() => {
                      if (!nextPrayer) return;
                      logPrayer.mutate({
                        date: nasr.today,
                        key: nextPrayer[0],
                        status: "ontime",
                      });
                    }}
                  >
                    On time
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      if (!nextPrayer) return;
                      logPrayer.mutate({
                        date: nasr.today,
                        key: nextPrayer[0],
                        status: "qada",
                      });
                    }}
                  >
                    Qada
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </div>
          {logPrayer.isError && (
            <p role="alert" className="mt-2 text-xs text-negative">
              The prayer could not be saved. {logPrayer.error.message}
            </p>
          )}

          <Rule />

          {/* Read-only on purpose: the practices are logged on Today, where
              the duas are, so Home holds no controls for them. */}
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Today's practices">
            {practices.map((practice) => (
              <li key={practice.key}>
                <Link
                  to="/nasr"
                  search={{ guide: practice.key }}
                  className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-muted/60"
                >
                  {practice.complete ? (
                    <Check className="size-4 shrink-0 text-positive" aria-hidden />
                  ) : (
                    <Circle
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      !practice.complete && "text-muted-foreground",
                    )}
                  >
                    {practice.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {practice.done}/{practice.total}
                  </span>
                  <span className="sr-only">
                    {practice.complete ? "done" : "not done"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Logged on Nasr, beside the duas. A row opens its guide there.
          </p>

          <Rule />

          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.8125rem] text-muted-foreground">
              Istighfar
            </span>
            <span className="font-mono text-[0.8125rem] tabular-nums">
              {number(day.istighfar_count)} / {number(target)}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-track"
            role="img"
            aria-label={`Istighfar ${day.istighfar_count} of ${target}`}
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${istighfar}%` }}
            />
          </div>

          <div className="section my-5" />

          <div className="flex items-center justify-between gap-3">
            <p className="section-label">The last 40 days</p>
            <span className="text-[0.8125rem] text-muted-foreground">
              {nasr.windowDays} of 40 days logged
            </span>
          </div>

          {/* The strip is the day picker: each mark opens its day on Today. */}
          <ul
            className="mt-4 grid grid-cols-10 gap-1 sm:grid-cols-[repeat(20,minmax(0,1fr))]"
            aria-label="One mark per day of the last 40 days"
          >
            {marks.map((mark) => (
              <li key={mark.date}>
                {/* No preload: the links above already load Nasr, and forty
                    more would only repeat it. */}
                <Link
                  to="/nasr"
                  search={{ date: mark.date }}
                  preload={false}
                  aria-label={markLabel(mark)}
                  title={markLabel(mark)}
                  className={cn(
                    "flex h-6 flex-col-reverse overflow-hidden rounded-[3px] bg-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:h-5",
                    mark.today && "outline-2 outline-offset-1 outline-primary",
                  )}
                >
                  {/* Bottom-up: on time, then qada, then missed. The track
                      showing through is what was never logged. */}
                  {mark.ontime > 0 && (
                    <span
                      aria-hidden
                      className="block w-full bg-positive"
                      style={{ height: `${(mark.ontime / 5) * 100}%` }}
                    />
                  )}
                  {mark.qada > 0 && (
                    <span
                      aria-hidden
                      className="block w-full bg-warning"
                      style={{ height: `${(mark.qada / 5) * 100}%` }}
                    />
                  )}
                  {mark.missed > 0 && (
                    <span
                      aria-hidden
                      className="block w-full bg-negative"
                      style={{ height: `${(mark.missed / 5) * 100}%` }}
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Tap a day to open it.{emptyDays ? ` ${emptyDays}` : null}
          </p>

          <dl className="mt-4 grid grid-cols-3 gap-x-4">
            {figures.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="section-label">{label}</dt>
                <dd className="figure mt-1.5">{value}%</dd>
              </div>
            ))}
          </dl>

          <Rule />
          {/* The streak is not windowed, so its row says so: the eyebrow above
              covers only the strip and its figures. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.8125rem] text-muted-foreground">
              Fajr streak, all time
            </span>
            <span className="font-mono text-[0.8125rem] tabular-nums">
              {nasr.fajrStreak.current}{" "}
              {nasr.fajrStreak.current === 1 ? "day" : "days"}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[0.8125rem] text-muted-foreground">Best</span>
            <span className="font-mono text-[0.8125rem] tabular-nums">
              {nasr.fajrStreak.longest}{" "}
              {nasr.fajrStreak.longest === 1 ? "day" : "days"}
            </span>
          </div>

          <div className="mt-5 flex-1" />
          <Link
            to="/nasr"
            className="text-[0.8125rem] font-medium text-primary"
          >
            Open Nasr tracker <ArrowRight className="inline size-3.5" />
          </Link>
        </section>

        <WaitingCard />

        <section
          id="code"
          className={cn("card scroll-mt-16 p-5", !chart && "self-start")}
          aria-labelledby="code-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="code-heading" className="section-title">
              Last 7 days in code
            </h2>
            <Link
              to="/github"
              search={defaultFilters()}
              className="text-[0.8125rem] font-medium text-primary"
            >
              Open GitHub <ArrowRight className="inline size-3.5" />
            </Link>
          </div>

          {github.repositories === 0 ? (
            <>
              <p className="mt-4 text-muted-foreground">
                No repositories imported yet. Add them once and commits land here
                on their own.
              </p>
              <Link
                to="/github/repositories"
                search={defaultFilters()}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "mt-4",
                )}
              >
                Add repositories <ArrowRight className="size-4" />
              </Link>
            </>
          ) : (
            <>
              <dl className="mt-3.5 grid grid-cols-3 gap-x-4 gap-y-4">
                <div className="min-w-0">
                  <dt className="section-label">Requests merged</dt>
                  <dd className="figure mt-1.5">{number(week.authoredPrs)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="section-label">Commits</dt>
                  <dd className="figure mt-1.5">{number(week.commits)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="section-label">Active days</dt>
                  <dd className="figure mt-1.5">
                    {week.activeDays}
                    <span className="font-normal text-muted-foreground"> / 7</span>
                  </dd>
                </div>
              </dl>
              <p className="mt-3 font-mono text-xs tabular-nums">
                <span className="text-positive">+{number(week.additions)}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-negative">
                  &minus;{number(week.deletions)}
                </span>
                <span className="text-muted-foreground"> lines</span>
              </p>
              {/* The chart keeps one height whatever the counts, so the card
                  does not jump when they change. */}
              <div className="mt-5">
                <p className="section-label">Requests merged per day</p>
                {/* The axis is drawn whether or not anything was merged: a week
                    of nothing is a fact about the week, not a missing chart. */}
                <MergedPerDay days={week.days} />
                {peak === 0 && (
                  <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                    Nothing merged in the last 7 days.
                  </p>
                )}
              </div>

              <Rule />

              {/* Not limited to the week: this says what shipped last. */}
              <h3 id="code-latest" className="section-label">
                Latest merged
              </h3>
              {github.latestMerged.length ? (
                <ul className="list mt-1 min-w-0" aria-labelledby="code-latest">
                  {github.latestMerged.map((request) => (
                    <li key={request.url} className="min-w-0">
                      <a
                        href={request.url}
                        target="_blank"
                        rel="noreferrer"
                        title={request.repo}
                        className="block py-2"
                      >
                        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">
                            {repoName(request.repo)} · #{request.number}
                          </span>
                          <span
                            className="font-mono tabular-nums"
                            suppressHydrationWarning
                          >
                            {age(request.mergedAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 break-words">
                          {request.title}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Nothing merged yet.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section
        id="flight"
        className="card scroll-mt-16 p-5"
        aria-labelledby="flight-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="flight-heading" className="section-title">
            In flight
          </h2>
          <Link
            to="/content/board"
            search={{}}
            className="text-[0.8125rem] font-medium text-primary"
          >
            Open board <ArrowRight className="inline size-3.5" />
          </Link>
        </div>

        {content.total === 0 ? (
          <>
            <p className="mt-4 text-muted-foreground">
              Nothing in flight. Streams, videos, posts, and articles all start
              as a page.
            </p>
            <Button
              size="lg"
              className="mt-4"
              disabled={creating}
              onClick={() => {
                setCreating(true);
                void newPage().finally(() => setCreating(false));
              }}
            >
              <FilePlus2 /> New page
            </Button>
          </>
        ) : (
          <>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap gap-2">
                {content.counts
                  .filter((status) => status.count > 0)
                  .map((status) => (
                    <span
                      key={status.id}
                      className="inline-flex h-[1.375rem] items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium text-muted-foreground"
                    >
                      <Dot color={status.color} className="size-1.5" />
                      {status.name}
                      <span className="font-mono tabular-nums">
                        {status.count}
                      </span>
                    </span>
                  ))}
              </div>
              {quiet && (
                <p className="text-xs text-muted-foreground">
                  No page edited or moved in 2 weeks
                </p>
              )}
            </div>
            <Rule />
            {/* Pinned pages first, then the rest by their last edit. */}
            <ul className="list">
              {content.recent.map((page, index) => (
                <li
                  key={page.id}
                  className={index === 3 ? "max-lg:hidden" : undefined}
                >
                  <Link
                    to="/content"
                    search={{ page: page.id }}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{page.title}</span>
                      {page.pinned && (
                        <Chip className="shrink-0 bg-primary/10 text-primary">
                          Pinned
                        </Chip>
                      )}
                    </span>
                    <span className="col-start-1 truncate text-xs text-muted-foreground sm:col-start-2">
                      {[page.type, page.status].filter(Boolean).join(" · ") ||
                        "No type"}
                    </span>
                    <span
                      className={cn(
                        "col-start-2 row-start-1 row-span-2 min-w-[4.5rem] text-right font-mono text-xs tabular-nums sm:col-start-3 sm:row-span-1",
                        isQuiet(page.updatedAt)
                          ? "text-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {relativeTime(page.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Rule />
            <Button
              variant="outline"
              disabled={creating}
              onClick={() => {
                setCreating(true);
                void newPage().finally(() => setCreating(false));
              }}
            >
              <FilePlus2 /> New page
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

/** One part of the status line: its figures set apart, the whole a link to its card. */
function StatusLink({ segment }: { segment: StatusSegment }) {
  // Ages read the clock, which moves between the server render and
  // hydration. Keep the server's text rather than flag the drift.
  const figure = "font-mono font-semibold tabular-nums text-foreground";
  return (
    // No preload: the link stays on this page. The hash is part of the
    // match, or every part would read as the current page, since "/" is
    // Home's own path.
    <Link
      to="/"
      hash={segment.card}
      activeOptions={{ includeHash: true }}
      preload={false}
      className="whitespace-nowrap transition-colors hover:text-foreground"
    >
      {segment.lead && (
        <>
          <span className={figure} suppressHydrationWarning>
            {segment.lead}
          </span>{" "}
        </>
      )}
      {segment.text}
      {segment.tail && (
        <>
          {" "}
          <span className={figure} suppressHydrationWarning>
            {segment.tail}
          </span>
        </>
      )}
    </Link>
  );
}

/** A 20px label on a row: why the row is there, or what state it is in. */
function Chip({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[0.6875rem] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * What waits on you on GitHub, read live rather than from the imported
 * snapshots, and on its own query so a slow search never holds up the day.
 */
function WaitingCard() {
  const work = useQuery(openWorkSummaryQuery);
  const data = work.data;
  const failed =
    Boolean(work.error) ||
    Boolean(data?.error) ||
    Boolean(data && !data.connected);
  return (
    <section
      id="waiting"
      className="card flex min-w-0 scroll-mt-16 flex-col p-5"
      aria-labelledby="waiting-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="waiting-heading" className="section-title">
          Waiting on you
        </h2>
        {data && data.connected ? (
          // Ages read the clock, which moves between the server render and
          // hydration. Keep the server's text rather than flag the drift.
          <span
            className="text-[0.8125rem] text-muted-foreground"
            suppressHydrationWarning
          >
            {age(data.fetchedAt)} ago
          </span>
        ) : null}
      </div>

      {work.isPending ? (
        <div className="mt-4 space-y-3" aria-label="Loading open work">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <>
          {data && data.connected ? (
            <>
              <dl className="mt-3.5 grid grid-cols-3 gap-x-4 gap-y-4">
                {(
                  [
                    ["Needs you", data.needsYou],
                    ["Needs triage", data.triage],
                    ["Going stale", data.stale],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="section-label">{label}</dt>
                    <dd className="figure mt-1.5">{number(value)}</dd>
                  </div>
                ))}
              </dl>

              <Rule />

              {data.waiting.length ? (
                <>
                  {/* The Overview's order, labelled so it is not read as
                      recency: review requests and assignments together, the
                      quietest first, with the reason on each row. It replaces
                      the oldest-created order that #10 and #124 chose, so Home
                      and Overview agree on what to act on first. */}
                  <h3 id="waiting-order" className="section-label">
                    Reviews and assignments, quietest first
                  </h3>
                  <ul className="list mt-1 min-w-0" aria-labelledby="waiting-order">
                    {data.waiting.map((item) => (
                      <li key={item.id} className="min-w-0">
                        {/* Two lines: in a third of the row there is no room
                            for the repo and the title side by side, so the
                            title gets its own line and the owner moves to the
                            tooltip. */}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          title={item.repo}
                          className="block py-2"
                        >
                          <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">
                              {repoName(item.repo)} · #{item.number}
                            </span>
                            <span
                              className="font-mono tabular-nums"
                              suppressHydrationWarning
                            >
                              {age(item.updatedAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 break-words">
                            {item.title}
                          </span>
                          <span className="mt-1.5 flex flex-wrap gap-1.5">
                            <Chip
                              className={
                                item.reasons.includes("review")
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              }
                            >
                              {reasonLabel(item)}
                            </Chip>
                            {isStale(item.updatedAt) && (
                              <Chip className="bg-warning/15 text-warning">
                                Quiet 14+ days
                              </Chip>
                            )}
                            {item.draft && (
                              <Chip className="bg-muted text-muted-foreground">
                                Draft
                              </Chip>
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : failed ? null : (
                <p className="text-muted-foreground">Nothing needs you.</p>
              )}
            </>
          ) : null}

          {failed ? (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-xs text-negative"
            >
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {work.error?.message || data?.error || "Could not read GitHub."}
              </span>
            </p>
          ) : null}

          <div className="mt-5 flex-1" />
          <Link
            to="/github/work"
            search={defaultFilters()}
            className="text-[0.8125rem] font-medium text-primary"
          >
            Open GitHub work <ArrowRight className="inline size-3.5" />
          </Link>
        </>
      )}
    </section>
  );
}

function statusLabel(status: PrayerStatus) {
  return status === "ontime"
    ? "on time"
    : status === "qada"
      ? "qada"
      : status === "missed"
        ? "missed"
        : "not logged";
}

function MergedPerDay({ days }: { days: { day: string; prs: number }[] }) {
  const definition = useMemo(
    () =>
      weekChart(days, {
        label: (entry) =>
          `${entry.day} — ${entry.prs} ${entry.prs === 1 ? "request" : "requests"} merged`,
        tick: weekday,
      }),
    [days],
  );
  return (
    <Chart
      definition={definition}
      height={128}
      initialWidth={260}
      className="mt-3"
      ariaLabel={`Requests merged per day, ${days.map((entry) => `${weekday(entry.day)} ${entry.prs}`).join(", ")}`}
    />
  );
}

function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}

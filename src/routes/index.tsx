import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Circle, FilePlus2 } from "lucide-react";
import { homeQuery, nasrKeys } from "@/queries/nasr";
import { openWorkQuery } from "@/queries/dashboard";
import { age, countKinds } from "@/lib/openWork";
import { useNewPage } from "@/queries/content";
import { updateNasrDay } from "@/server/fns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Dot } from "@/components/content/properties";
import { relativeTime } from "@/lib/content";
import {
  markLabel,
  middayPrayerLabel,
  windowStrip,
  type PrayerStatus,
} from "@/lib/nasr";
import { defaultFilters } from "@/lib/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: HomePage,
});

const WORDS = ["No", "One", "Two", "Three", "Four", "Five"] as const;
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
  const newPage = useNewPage();
  const [creating, setCreating] = useState(false);
  const logPrayer = useMutation({
    mutationFn: ({ date, key, status }: { date: string; key: PrayerKey; status: LoggedStatus }) =>
      updateNasrDay({ data: { date, [key]: status } }),
    onMutate: async ({ key, status }) => {
      await queryClient.cancelQueries({ queryKey: nasrKeys.home });
      const previous = queryClient.getQueryData(homeQuery.queryKey);
      queryClient.setQueryData(homeQuery.queryKey, (current) =>
        current
          ? {
              ...current,
              nasr: {
                ...current.nasr,
                day: { ...current.nasr.day, [key]: status },
              },
            }
          : current,
      );
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
  const practices = [
    ["Morning adhkar", day.morning_adhkar],
    ["Evening adhkar", day.evening_adhkar],
    [
      "Night recitation",
      Boolean(
        day.night_ayat_kursi && day.night_baqarah && day.night_three_suras,
      ),
    ],
    ["Self-ruqyah", day.ruqyah],
  ] as const;
  const date = new Date(`${nasr.today}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const kept = practices.filter(([, done]) => done).length;
  const state =
    logged === 5
      ? kept === practices.length
        ? "All five prayers and every practice logged."
        : `All five prayers logged, ${WORDS[kept]?.toLowerCase()} of four practices kept.`
      : logged === 0
        ? "Nothing logged yet today."
        : `${WORDS[logged]} ${logged === 1 ? "prayer" : "prayers"} logged, ${WORDS[5 - logged]?.toLowerCase()} to go.`;
  const target = nasr.settings.istighfar_target;
  const istighfar = target > 0 ? Math.min(100, (day.istighfar_count / target) * 100) : 0;
  const marks = windowStrip(nasr.days, nasr.today);
  const week = github.week;
  // The bars count requests merged, not commits: the headline figures already
  // carry the commits, and a merged request is the unit of finished work.
  const peak = Math.max(...week.days.map((entry) => entry.prs), 0);
  const chart = github.repositories > 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="section-label">{date}</p>
          <h1 className="title mt-2">{state}</h1>
        </div>
      </header>

      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
        <section className="card flex flex-col p-5" aria-labelledby="nasr-heading">
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

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {practices.map(([label, done]) => (
              <li key={label} className="flex items-center gap-2">
                {done ? (
                  <Check className="size-4 shrink-0 text-positive" aria-hidden />
                ) : (
                  <Circle
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className={done ? undefined : "text-muted-foreground"}>
                  {label}
                </span>
                <span className="sr-only">{done ? "done" : "not done"}</span>
              </li>
            ))}
          </ul>

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

          <div className="mt-4 flex items-center gap-5">
            <div
              className="grid size-24 shrink-0 place-items-center rounded-full sm:size-[8.25rem]"
              style={{
                background: `conic-gradient(var(--primary) 0 ${nasr.overall.percentage}%, var(--track) ${nasr.overall.percentage}% 100%)`,
              }}
              role="img"
              aria-label={`${nasr.overall.percentage}% adherence over ${nasr.windowDays} logged days`}
            >
              <div className="grid size-[4.75rem] place-items-center rounded-full bg-card text-center sm:size-26">
                <div>
                  <p className="display text-xl sm:text-[1.75rem]">
                    {nasr.overall.percentage}%
                  </p>
                  <p className="section-label mt-1">adherence</p>
                </div>
              </div>
            </div>

            <div
              className="grid flex-1 grid-cols-10 gap-1 sm:grid-cols-[repeat(20,minmax(0,1fr))]"
              aria-label="One mark per day of the last 40 days"
              role="list"
            >
              {marks.map((mark) => (
                <span
                  key={mark.date}
                  role="listitem"
                  aria-label={markLabel(mark)}
                  title={markLabel(mark)}
                  className={cn(
                    "flex h-5 flex-col-reverse overflow-hidden rounded-[3px] bg-track",
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
                </span>
              ))}
            </div>
          </div>

          <Rule />
          {/* The streak is not windowed, so its row says so: the eyebrow above
              covers only the ring and the strip. */}
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

        <OpenWorkCard />

        <section
          className={cn(
            "card p-5",
            chart ? "flex min-h-[18rem] flex-col" : "self-start",
          )}
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
              <dl className="mt-3.5 flex flex-wrap gap-x-8 gap-y-4">
                <div>
                  <dt className="section-label">Commits</dt>
                  <dd className="figure mt-1.5">{number(week.commits)}</dd>
                </div>
                <div>
                  <dt className="section-label">Requests merged</dt>
                  <dd className="figure mt-1.5">{number(week.authoredPrs)}</dd>
                </div>
                <div>
                  <dt className="section-label">Lines changed</dt>
                  <dd className="figure mt-1.5">
                    <span className="text-positive">
                      +{number(week.additions)}
                    </span>
                    <span className="font-normal text-muted-foreground"> / </span>
                    <span className="text-negative">
                      &minus;{number(week.deletions)}
                    </span>
                  </dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-1 flex-col">
                <p className="section-label">Requests merged per day</p>
                {/* The axis is drawn whether or not anything was merged: a week
                    of nothing is a fact about the week, not a missing chart. */}
                <div
                  className="mt-3 flex flex-1 items-end gap-1.5 border-b"
                  role="img"
                  aria-label={`Requests merged per day, ${week.days.map((entry) => `${weekday(entry.day)} ${entry.prs}`).join(", ")}`}
                >
                  {week.days.map((entry) => (
                    <span
                      key={entry.day}
                      title={`${entry.day} — ${entry.prs} ${entry.prs === 1 ? "request" : "requests"} merged`}
                      className="flex-1 rounded-t-[3px] bg-primary/85"
                      style={{
                        height:
                          peak > 0
                            ? `${Math.max(2, (entry.prs / peak) * 100)}%`
                            : 0,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  {week.days.map((entry) => (
                    <span
                      key={entry.day}
                      className="flex-1 text-center text-[0.6875rem] text-muted-foreground"
                    >
                      {weekday(entry.day)}
                    </span>
                  ))}
                </div>
                {peak === 0 && (
                  <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                    Nothing merged in the last 7 days.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card p-5" aria-labelledby="flight-heading">
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
              No pages yet. Streams, videos, posts, and articles all start as a
              page.
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
            <div className="mt-3.5 flex flex-wrap gap-2">
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
            <Rule />
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
                    <span className="truncate font-medium">{page.title}</span>
                    <span className="col-start-1 truncate text-xs text-muted-foreground sm:col-start-2">
                      {[page.type, page.status].filter(Boolean).join(" · ") ||
                        "No type"}
                    </span>
                    <span className="col-start-2 row-start-1 row-span-2 min-w-[4.5rem] text-right font-mono text-xs text-muted-foreground tabular-nums sm:col-start-3 sm:row-span-1">
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

/**
 * What is open on GitHub right now, read live rather than from the imported
 * snapshots, and on its own query so a slow search never holds up the day.
 */
function OpenWorkCard() {
  const work = useQuery(openWorkQuery);
  const data = work.data;
  const mine = data?.mine ?? [];
  const oldest = mine.slice(0, 5);
  const kinds = countKinds(mine);
  const failed = Boolean(work.error) || Boolean(data && !data.connected);
  return (
    <section
      className="card flex min-w-0 flex-col p-5"
      aria-labelledby="work-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="work-heading" className="section-title">
          Open work
        </h2>
        {data && data.connected ? (
          <span className="text-[0.8125rem] text-muted-foreground">
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
      ) : failed ? (
        <>
          <p className="mt-4 text-muted-foreground">
            Connect GitHub to see open work.
          </p>
          <div className="mt-5 flex-1" />
          <Link
            to="/github/work"
            search={defaultFilters()}
            className="text-[0.8125rem] font-medium text-primary"
          >
            Open GitHub work <ArrowRight className="inline size-3.5" />
          </Link>
        </>
      ) : (
        <>
          <dl className="mt-3.5 grid grid-cols-3 gap-x-4 gap-y-4">
            {(
              [
                ["Issues", kinds.issues],
                ["PRs", kinds.prs],
                ["Needs triage", data?.triage.length ?? 0],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="section-label">{label}</dt>
                <dd className="figure mt-1.5">{number(value)}</dd>
              </div>
            ))}
          </dl>

          <Rule />

          {oldest.length ? (
            <ul className="list min-w-0">
              {oldest.map((item) => (
                <li key={item.id} className="min-w-0">
                  {/* Three columns, each allowed to shrink to nothing: a repo
                      name and a title are both long enough to push a card
                      wider than the phone it is on. */}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-baseline gap-2 py-2"
                  >
                    <span className="truncate text-xs text-muted-foreground">
                      {item.repo}
                    </span>
                    <span className="truncate">{item.title}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {age(item.createdAt)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Nothing needs your attention.
            </p>
          )}

          {data?.error ? (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              Some of GitHub could not be read just now.
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

function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Minus } from "lucide-react";
import { homeQuery } from "@/queries/deen";
import { Button, buttonVariants } from "@/components/ui/button";
import { defaultFilters } from "@/lib/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: HomePage,
});

function HomePage() {
  const home = useQuery(homeQuery);
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
  const { deen, github } = home.data;
  const day = deen.day;
  const prayers = [
    ["Fajr", day.fajr],
    ["Dhuhr", day.dhuhr],
    ["Asr", day.asr],
    ["Maghrib", day.maghrib],
    ["Isha", day.isha],
  ] as const;
  const logged = prayers.filter(([, status]) => status !== null).length;
  const date = new Date(`${deen.today}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const practices = [
    ["Morning adhkar", day.morning_adhkar],
    ["Evening adhkar", day.evening_adhkar],
    [
      "Night recitation",
      day.night_ayat_kursi && day.night_baqarah && day.night_three_suras,
    ],
    ["Self-ruqyah", day.ruqyah],
  ] as const;
  return (
    <div className="space-y-8">
      <header className="page-header">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">{date}</p>
          <h1 className="page-title">Your day at a glance</h1>
          <p className="page-description">
            Today's practices and your week in code.
          </p>
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section
          className="panel overflow-hidden"
          aria-labelledby="today-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
            <h2 id="today-heading" className="text-base font-semibold">
              Nasr today
            </h2>
            <span className="text-xs text-muted-foreground">
              {deen.cycleDay
                ? deen.cycleComplete
                  ? "Cycle complete"
                  : `Day ${deen.cycleDay} of 40`
                : "Daily practice"}
            </span>
          </div>
          <div className="p-5 sm:p-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Salah logged</p>
                <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
                  {logged}
                  <span className="text-xl font-normal text-muted-foreground">
                    {" "}
                    / 5
                  </span>
                </p>
              </div>
              <Link to="/deen" className={buttonVariants({ size: "lg" })}>
                Continue today's practice <ArrowRight className="size-4" />
              </Link>
            </div>
            <ul className="divide-y border-y" aria-label="Today's prayers">
              {prayers.map(([label, status]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <span className="font-medium">{label}</span>
                  <span
                    className={cn(
                      "flex items-center gap-2 text-xs",
                      status === "ontime"
                        ? "text-positive"
                        : status === "missed"
                          ? "text-negative"
                          : "text-muted-foreground",
                    )}
                  >
                    {status === "ontime" ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Minus className="size-3.5" />
                    )}
                    {status === "ontime"
                      ? "On time"
                      : status === "qada"
                        ? "Qada"
                        : status === "missed"
                          ? "Missed"
                          : "Not logged"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {practices.map(([label, complete]) => (
                <div key={label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={
                      complete ? "text-positive" : "text-muted-foreground"
                    }
                  >
                    {complete ? (
                      <Check className="size-4" aria-label="Complete" />
                    ) : (
                      <Circle className="size-4" aria-label="Not complete" />
                    )}
                  </span>
                  {label}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Istighfar · {day.istighfar_count} /{" "}
                {deen.settings.istighfar_target}
              </span>
              <span>Fajr streak · {deen.fajrStreak.current} days</span>
            </div>
          </div>
        </section>
        <div className="space-y-6">
          <section className="panel p-5 sm:p-6" aria-labelledby="week-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="week-heading" className="text-base font-semibold">
                This week in code
              </h2>
              <span className="text-xs text-muted-foreground">Last 7 days</span>
            </div>
            {github.repositories ? (
              <>
                <p className="mt-6 text-4xl font-semibold tracking-tight tabular-nums">
                  {github.week.commits.toLocaleString()}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    commits
                  </span>
                </p>
                <dl className="mt-6 divide-y border-y">
                  <div className="flex justify-between gap-4 py-3">
                    <dt className="text-muted-foreground">
                      Your requests merged
                    </dt>
                    <dd className="font-mono">{github.week.authoredPrs}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-3">
                    <dt className="text-muted-foreground">
                      Repositories imported
                    </dt>
                    <dd className="font-mono">{github.repositories}</dd>
                  </div>
                </dl>
                <Link
                  to="/github"
                  search={defaultFilters()}
                  className={cn(
                    buttonVariants({ variant: "link" }),
                    "mt-4 px-0",
                  )}
                >
                  View activity <ArrowRight className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Add your repositories to see commits and merged requests here.
                </p>
                <Link
                  to="/github"
                  search={{ ...defaultFilters(), view: "projects" }}
                  className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
                >
                  Add repositories <ArrowRight className="size-4" />
                </Link>
              </>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

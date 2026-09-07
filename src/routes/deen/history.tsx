import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { deenQuery } from "@/queries/deen";
import {
  calculateAdherence,
  cycleDatesForDay,
  fajrOnTimeStreak,
  isCycleComplete,
  overallAdherence,
} from "@/lib/deen";

export const Route = createFileRoute("/deen/history")({
  loader: ({ context }) => context.queryClient.ensureQueryData(deenQuery),
  component: HistoryPage,
});

function HistoryPage() {
  const summary = useQuery(deenQuery);
  if (summary.isPending) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  const data = summary.data;
  if (!data) return null;
  const { settings, today, days, cycleDay } = data;
  const cycleComplete = isCycleComplete(cycleDay);
  const target = settings.istighfar_target;
  const cycleDays = cycleDay !== null ? Math.min(cycleDay, 40) : days.length;
  const adherence = calculateAdherence(days, cycleDays, target);
  const overall = overallAdherence(days, cycleDays, target);
  const fajrStreak = fajrOnTimeStreak(days, today);
  const calDates = settings.cycle_start_date
    ? cycleDatesForDay(settings.cycle_start_date)
    : [];
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const nothingLogged =
    !settings.cycle_start_date &&
    Object.values(adherence).every((value) => value.percentage === 0);

  return (
    <div className="space-y-8">
      <header className="page-header">
        <div>
          <h1 className="page-title">Progress</h1>
          <p className="page-description">Adherence across the 40-day cycle.</p>
        </div>
        {cycleDay !== null && (
          <span className="text-sm text-muted-foreground">
            {cycleComplete ? "Cycle complete" : `Day ${cycleDay} / 40`}
          </span>
        )}
      </header>

      {nothingLogged ? (
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Nothing is logged yet. Set your cycle start date in{" "}
          <Link to="/deen/settings" className="text-primary underline">
            Settings
          </Link>
          , then log a day on Today.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <p className="section-label">Fajr on time</p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="display">
                  {adherence.fajr_ontime?.percentage ?? 0}
                </span>
                <span className="display-unit">% of days</span>
              </p>
            </div>
            <div>
              <p className="section-label">Fajr streak</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {fajrStreak.current}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  best {fajrStreak.longest}
                </span>
              </p>
            </div>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
            <section aria-label="Salah progress" className="space-y-4">
              <h2 className="section-title">Salah</h2>
              <Breakdown
                adherence={adherence}
                items={[
                  ["fajr", "Fajr"],
                  ["dhuhr", "Dhuhr"],
                  ["asr", "Asr"],
                  ["maghrib", "Maghrib"],
                  ["isha", "Isha"],
                ]}
              />
            </section>
            <section
              aria-label="Other practices progress"
              className="hairline space-y-4 pt-8 lg:border-t-0 lg:pt-0"
            >
              <h2 className="section-title">Adhkar and other practices</h2>
              <Breakdown
                adherence={adherence}
                items={[
                  ["morning_adhkar", "Morning adhkar"],
                  ["evening_adhkar", "Evening adhkar"],
                  ["night_ayat_kursi", "Ayat al-Kursi"],
                  ["night_baqarah", "Al-Baqarah"],
                  ["night_three_suras", "Three surahs"],
                  ["ruqyah", "Ruqyah"],
                  ["istighfar", "Istighfar"],
                ]}
              />
            </section>
          </div>
        </>
      )}

      {calDates.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title">Fajr calendar</h2>
          <div className="panel p-3">
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(20,minmax(0,1fr))]">
              {calDates.map((date, i) => {
                const d = dayMap.get(date);
                const fajr = d?.fajr ?? null;
                const tone =
                  date > today
                    ? "bg-muted/40 text-muted-foreground"
                    : fajr === "ontime"
                      ? "bg-positive/15 text-positive"
                      : fajr === "qada"
                        ? "bg-chart-3/20"
                        : fajr === "missed"
                          ? "bg-negative/15 text-negative"
                          : d
                            ? "bg-muted text-muted-foreground"
                            : "bg-muted/40 text-muted-foreground";
                return (
                  <div
                    key={date}
                    title={`${date} — ${fajr ?? "not logged"}`}
                    className={`flex aspect-square items-center justify-center rounded-md text-xs font-medium tabular-nums ${tone}`}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
      {cycleComplete && (
        <div className="panel border-positive/30 p-6 text-center">
          <h3 className="text-base font-semibold">Cycle complete</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {overall.percentage}% overall adherence across {cycleDays} days.
          </p>
        </div>
      )}
    </div>
  );
}

function Breakdown({
  adherence,
  items,
}: {
  adherence: ReturnType<typeof calculateAdherence>;
  items: [string, string][];
}) {
  return (
    <div className="list">
      {items.map(([key, label]) => {
        const value = adherence[key]!;
        return (
          <div key={key} className="list-row">
            <span className="w-32 shrink-0 text-sm">{label}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${value.percentage}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {value.percentage}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

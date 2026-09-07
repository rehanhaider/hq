import { createFileRoute } from "@tanstack/react-router";
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

  return (
    <div className="max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Adherence across the 40-day cycle.
          </p>
        </div>
        {cycleDay !== null && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
            {cycleComplete ? "Cycle complete" : `Day ${cycleDay} / 40`}
          </span>
        )}
      </header>
      <section aria-label="Salah progress" className="space-y-4">
        <h2 className="font-semibold">Salah</h2>
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Fajr on time"
            value={`${adherence.fajr_ontime?.percentage ?? 0}%`}
          />
          <Stat
            label="Fajr streak"
            value={String(fajrStreak.current)}
            sub={`best ${fajrStreak.longest}`}
          />
        </div>
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
        className="space-y-4 border-t pt-6"
      >
        <h2 className="font-semibold">Adhkar and other practices</h2>
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
      {calDates.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title">Fajr calendar</h2>
          <div className="panel p-3">
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
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
                    className={`flex aspect-square items-center justify-center rounded-md font-mono text-xs font-medium tabular-nums ${tone}`}
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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border-l-2 py-1 pl-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{sub}</p>
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
    <div className="panel divide-y">
      {items.map(([key, label]) => {
        const value = adherence[key]!;
        return (
          <div key={key} className="flex items-center gap-4 px-4 py-3">
            <span className="w-32 shrink-0 text-sm">{label}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${value.percentage}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {value.percentage}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

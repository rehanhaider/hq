import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { deenQuery } from "@/queries/deen";
import type { AdherenceResult } from "@/lib/deen";
import { windowDates } from "@/lib/deen";

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
  // Adherence, the streak and the count of logged days in the window come
  // from the server, so the window adherence is measured over is defined in
  // one place. The calendar draws the same window from `windowDates`.
  const { today, days, windowDays, adherence, fajrStreak } = data;
  const calDates = windowDates(today);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  // Zero adherence means nothing was logged *in the window*, which is not the
  // same as having no history: records older than the window read as all-zero.
  const nothingLogged = days.length === 0;
  const emptyWindow = !nothingLogged && windowDays === 0;

  return (
    <div className="space-y-8">
      {nothingLogged ? (
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Nothing is logged yet. Log a day on Today.
        </p>
      ) : (
        <>
          {/* Each figure names the span it covers: only adherence is windowed,
              so a shared "last 40 days" heading would misdescribe the streak. */}
          <div className="flex flex-wrap items-end gap-x-12 gap-y-6">
            {/* Adherence is windowed; an empty window has no percentage to show. */}
            {!emptyWindow && (
              <div>
                <p className="section-label">Fajr on time, last 40 days</p>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="display">
                    {adherence.fajr_ontime?.percentage ?? 0}
                  </span>
                  <span className="text-base font-normal text-muted-foreground">
                    % of {windowDays} logged {windowDays === 1 ? "day" : "days"}
                  </span>
                </p>
              </div>
            )}
            {/* The streak runs over the full history, so it stays visible even
                when the window is empty — Today and Home both show it. */}
            <div>
              <p className="section-label">Fajr streak, all time</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {fajrStreak.current}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  best {fajrStreak.longest}
                </span>
              </p>
            </div>
          </div>

          {emptyWindow ? (
            <p className="max-w-prose text-sm leading-6 text-muted-foreground">
              Nothing is logged in the last 40 days. Earlier records are still
              stored.
            </p>
          ) : (
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
              className="section space-y-4 pt-8 lg:border-t-0 lg:pt-0"
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
          )}
        </>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="section-title">Fajr calendar</h2>
          <span className="text-xs text-muted-foreground">
            The last 40 days, today last
          </span>
        </div>
        <div className="card p-3">
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-[repeat(20,minmax(0,1fr))]">
            {calDates.map((date) => {
              const d = dayMap.get(date);
              const fajr = d?.fajr ?? null;
              const tone =
                fajr === "ontime"
                  ? "bg-positive/15 text-positive"
                  : fajr === "qada"
                    ? "bg-warning/20 text-warning"
                    : fajr === "missed"
                      ? "bg-negative/15 text-negative"
                      : d
                        ? "bg-muted text-muted-foreground"
                        : "bg-muted/40 text-muted-foreground";
              return (
                <div
                  key={date}
                  title={`${date} — ${fajr ?? "not logged"}`}
                  className={`flex aspect-square items-center justify-center rounded-md text-xs font-medium tabular-nums ${tone} ${date === today ? "outline-2 outline-offset-1 outline-primary" : ""}`}
                >
                  {Number(date.slice(8))}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function Breakdown({
  adherence,
  items,
}: {
  adherence: Record<string, AdherenceResult>;
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

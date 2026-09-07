import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { deenDayQuery, deenKeys, deenQuery } from "@/queries/deen";
import { updateDeenDay } from "@/server/fns";
import { Button } from "@/components/ui/button";
import {
  DEEN_GUIDES,
  shiftDate,
  type DeenContent,
  type DeenContentItemKey,
  type DeenDay,
  type PrayerStatus,
} from "@/lib/deen";

export const Route = createFileRoute("/deen/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(deenQuery),
  component: TodayPage,
});

const prayers: Array<{
  key: keyof Pick<DeenDay, "fajr" | "dhuhr" | "asr" | "maghrib" | "isha">;
  label: string;
}> = [
  { key: "fajr", label: "Fajr" },
  { key: "dhuhr", label: "Dhuhr" },
  { key: "asr", label: "Asr" },
  { key: "maghrib", label: "Maghrib" },
  { key: "isha", label: "Isha" },
];

const boolItems: Array<{
  key: keyof Pick<DeenDay, "morning_adhkar" | "evening_adhkar" | "ruqyah">;
  itemKey: DeenContentItemKey;
}> = [
  { key: "morning_adhkar", itemKey: "morning_adhkar" },
  { key: "evening_adhkar", itemKey: "evening_adhkar" },
  { key: "ruqyah", itemKey: "ruqyah" },
];

function TodayPage() {
  const queryClient = useQueryClient();
  const summary = useQuery(deenQuery);
  const [offset, setOffset] = useState(0);
  const today = summary.data?.today ?? "";
  const selected = today ? shiftDate(today, offset) : "";
  const isToday = offset === 0;
  const dayQuery = useQuery(deenDayQuery(selected));
  const update = useMutation({
    mutationFn: updateDeenDay,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deenKeys.all });
      await queryClient.invalidateQueries({ queryKey: deenKeys.home });
    },
  });
  if (summary.isPending) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  const data = summary.data;
  const day = dayQuery.data;
  const logged = prayers.filter(
    ({ key }) => (day?.[key] ?? null) !== null,
  ).length;
  function patch(values: Parameters<typeof updateDeenDay>[0]["data"]) {
    update.mutate({ data: values });
  }
  function togglePrayer(
    key: (typeof prayers)[number]["key"],
    current: PrayerStatus,
  ) {
    const cycle: Exclude<PrayerStatus, null>[] = ["ontime", "qada", "missed"];
    const idx = current === null ? -1 : cycle.indexOf(current);
    patch({ date: selected, [key]: cycle[(idx + 1) % cycle.length] });
  }
  return (
    <div className="max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            disabled={update.isPending}
            aria-label="Previous day"
            onClick={() => setOffset((value) => value - 1)}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isToday ? "Today" : "Previous day"}
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {selected}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            disabled={isToday || update.isPending}
            onClick={() => setOffset((value) => Math.min(0, value + 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data?.cycleDay !== null && data?.cycleDay !== undefined && (
            <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">
              {data.cycleComplete
                ? "Cycle complete"
                : `Day ${data.cycleDay} / 40`}
            </span>
          )}
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
            {data?.fajrStreak.current ?? 0}d Fajr streak
          </span>
        </div>
      </header>

      {update.isError && (
        <p role="alert" className="text-sm text-negative">
          Your change could not be saved. {update.error.message}
        </p>
      )}
      {dayQuery.isError && (
        <p role="alert" className="text-sm text-negative">
          This day could not load. {dayQuery.error.message}
        </p>
      )}
      <fieldset
        disabled={update.isPending || dayQuery.isPending || dayQuery.isError}
        className="min-w-0 space-y-8 disabled:opacity-60"
      >
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="section-title">Salah</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {logged}/5 logged
            </span>
          </div>
          <div className="panel divide-y">
            {prayers.map(({ key, label }) => {
              const value = (day?.[key] ?? null) as PrayerStatus;
              return (
                <div key={key} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => togglePrayer(key, value)}
                    className="flex min-h-11 flex-1 items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${statusTone(value)}`}
                    >
                      {statusLabel(value)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ date: selected, [key]: null })}
                    disabled={value === null}
                    aria-label={`Clear ${label}`}
                    className="px-3 py-3 text-sm text-muted-foreground disabled:opacity-0"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="section-title">Daily practices</h2>
            <span className="text-xs text-muted-foreground">
              Open a row for the recitation
            </span>
          </div>
          <div className="space-y-2">
            {boolItems.map(({ key, itemKey }) => (
              <PracticeDisclosure
                key={key}
                itemKey={itemKey}
                complete={day?.[key] ?? false}
                items={(data?.content ?? []).filter(
                  (item) => item.item_key === itemKey,
                )}
                onToggle={() =>
                  patch({ date: selected, [key]: !(day?.[key] ?? false) })
                }
              />
            ))}
            <NightDisclosure
              day={day}
              items={(data?.content ?? []).filter(
                (item) => item.item_key === "night_ayat",
              )}
              onToggle={(key, value) =>
                patch({ date: selected, [key]: !value })
              }
            />
          </div>
        </section>

        <section className="space-y-3">
          <GuideHeading
            label="Istighfar"
            itemKey="istighfar"
            items={(data?.content ?? []).filter(
              (item) => item.item_key === "istighfar",
            )}
          />
          <IstighfarCounter
            count={day?.istighfar_count ?? 0}
            target={data?.settings.istighfar_target ?? 100}
            onUpdate={(count) =>
              patch({ date: selected, istighfar_count: count })
            }
          />
        </section>
      </fieldset>
    </div>
  );
}

function statusLabel(value: PrayerStatus) {
  if (value === "ontime") return "On time";
  if (value === "qada") return "Qada";
  if (value === "missed") return "Missed";
  return "Not set";
}

function statusTone(value: PrayerStatus) {
  if (value === "ontime") return "bg-positive/10 text-positive";
  if (value === "qada") return "bg-chart-3/15";
  if (value === "missed") return "bg-negative/10 text-negative";
  return "bg-muted text-muted-foreground";
}

function PracticeDisclosure({
  itemKey,
  complete,
  items,
  onToggle,
}: {
  itemKey: DeenContentItemKey;
  complete: boolean;
  items: DeenContent[];
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const guide = DEEN_GUIDES[itemKey];
  return (
    <article
      className={`panel overflow-hidden ${complete ? "border-positive/30" : ""}`}
    >
      <div className="flex min-h-14 items-stretch">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">{guide.title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {guide.window}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${complete ? "Mark incomplete" : "Mark complete"}: ${guide.title}`}
          className="flex w-16 shrink-0 items-center justify-center border-l"
        >
          <CheckMark complete={complete} />
        </button>
      </div>
      {open && <PracticeGuide itemKey={itemKey} items={items} />}
    </article>
  );
}

function NightDisclosure({
  day,
  items,
  onToggle,
}: {
  day: DeenDay | undefined;
  items: DeenContent[];
  onToggle: (
    key: "night_ayat_kursi" | "night_baqarah" | "night_three_suras",
    current: boolean,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const checks = [
    {
      key: "night_ayat_kursi" as const,
      label: "Ayat al-Kursi",
      value: day?.night_ayat_kursi ?? false,
    },
    {
      key: "night_baqarah" as const,
      label: "Al-Baqarah 285–286",
      value: day?.night_baqarah ?? false,
    },
    {
      key: "night_three_suras" as const,
      label: "Three suras + wipe",
      value: day?.night_three_suras ?? false,
    },
  ];
  const completed = checks.filter((check) => check.value).length;
  return (
    <article
      className={`panel overflow-hidden ${completed === 3 ? "border-positive/30" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-medium">
            Night recitation{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {completed}/3
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            At bedtime · tracked in three parts
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t">
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {checks.map((check) => (
              <button
                key={check.key}
                type="button"
                onClick={() => onToggle(check.key, check.value)}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium ${check.value ? "border-positive/30 bg-positive/10 text-positive" : "text-muted-foreground"}`}
              >
                <CheckMark complete={check.value} />
                {check.label}
              </button>
            ))}
          </div>
          <PracticeGuide itemKey="night_ayat" items={items} nested />
        </div>
      )}
    </article>
  );
}

function GuideHeading({
  label,
  itemKey,
  items,
}: {
  label: string;
  itemKey: DeenContentItemKey;
  items: DeenContent[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">{label}</h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="text-xs font-medium text-primary"
        >
          {open ? "Hide guide" : "Open guide"}
        </button>
      </div>
      {open && <PracticeGuide itemKey={itemKey} items={items} />}
    </>
  );
}

function PracticeGuide({
  itemKey,
  items,
  nested = false,
}: {
  itemKey: DeenContentItemKey;
  items: DeenContent[];
  nested?: boolean;
}) {
  const guide = DEEN_GUIDES[itemKey];
  return (
    <div className={`${nested ? "" : "border-t"} bg-muted/30 px-4 pb-5 pt-4`}>
      <p className="text-xs font-medium text-primary">{guide.window}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {guide.summary}
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Loading the recitation guide…
        </p>
      ) : (
        <ol className="mt-5 space-y-4">
          {items.map((item, index) => (
            <ContentEntry key={item.id} item={item} number={index + 1} />
          ))}
        </ol>
      )}
      {guide.closingNote && (
        <p className="mt-5 border-l-2 border-primary/50 pl-3 text-xs leading-5 text-muted-foreground">
          {guide.closingNote}
        </p>
      )}
    </div>
  );
}

function ContentEntry({ item, number }: { item: DeenContent; number: number }) {
  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {String(number).padStart(2, "0")}
          </span>
          <h3 className="text-sm font-semibold leading-5">{item.title}</h3>
        </div>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {item.repetitions}
        </span>
      </div>
      {item.arabic && (
        <p
          lang="ar"
          dir="rtl"
          className="mt-5 whitespace-pre-line text-right font-serif text-[1.65rem] leading-[2.15]"
        >
          {item.arabic}
        </p>
      )}
      {item.transliteration && (
        <p className="mt-4 whitespace-pre-line text-sm italic leading-6 text-muted-foreground">
          {item.transliteration}
        </p>
      )}
      {item.meaning && (
        <p className="mt-3 whitespace-pre-line text-sm leading-6">
          {item.meaning}
        </p>
      )}
      {item.note && (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
          {item.note}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-start gap-2 border-t pt-3">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs uppercase tracking-wide">
          {item.grade}
        </span>
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
          {item.reference}
        </p>
      </div>
    </li>
  );
}

function CheckMark({ complete }: { complete: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${complete ? "border-positive bg-positive text-primary-foreground" : "border-input"}`}
    >
      {complete && (
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function IstighfarCounter({
  count,
  target,
  onUpdate,
}: {
  count: number;
  target: number;
  onUpdate: (n: number) => void;
}) {
  const pct = Math.min(100, Math.round((count / target) * 100));
  return (
    <div className="panel p-5">
      <div className="flex items-end justify-between">
        <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
          {count}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {pct}% of {target}
        </span>
      </div>
      <div className="my-4 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-2">
        {[1, 10, 33].map((step) => (
          <Button
            key={step}
            variant="secondary"
            className="min-h-11 flex-1 font-mono"
            onClick={() => onUpdate(count + step)}
          >
            +{step}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="min-h-11 font-mono"
          disabled={count === 0}
          aria-label="Decrement istighfar count"
          onClick={() => onUpdate(Math.max(0, count - 1))}
        >
          −1
        </Button>
      </div>
    </div>
  );
}

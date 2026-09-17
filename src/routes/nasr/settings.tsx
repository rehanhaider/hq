import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exportNasr, resetNasr, updateNasrSettings } from "@/server/fns";
import { nasrKeys, nasrSettingsQuery } from "@/queries/nasr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/nasr/settings")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(nasrSettingsQuery),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery(nasrSettingsQuery);
  const [timezone, setTimezone] = useState("");
  const [target, setTarget] = useState("100");
  useEffect(() => {
    if (!settings.data) return;
    setTimezone(settings.data.timezone);
    setTarget(String(settings.data.istighfar_target));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: updateNasrSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: nasrKeys.all });
      await queryClient.invalidateQueries({ queryKey: nasrKeys.home });
    },
  });
  const download = useMutation({
    mutationFn: exportNasr,
    onSuccess: (file) => {
      const blob = new Blob([file.body], {
        type: file.format === "csv" ? "text/csv" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.format === "csv" ? "nasr.csv" : "nasr.json";
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  if (settings.isPending) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-12">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              data: {
                timezone,
                istighfar_target: Number(target),
              },
            });
          }}
        >
          <div className="card divide-y">
            <Row label="Timezone" hint="e.g. Asia/Kolkata, America/New_York">
              <Input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </Row>
            <Row label="Istighfar daily target">
              <Input
                type="number"
                min="1"
                className="tabular-nums"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </Row>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
            {save.isSuccess && (
              <span className="text-xs text-positive">Saved.</span>
            )}
          </div>
        </form>
        <div className="space-y-8">
          <section className="space-y-2">
            <h2 className="section-label">Data</h2>
            <div className="list">
              <button
                type="button"
                className="list-row w-full text-left"
                onClick={() => download.mutate({ data: { format: "json" } })}
              >
                <span>
                  <span className="block text-sm font-medium">
                    Full JSON export
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Practice history and settings
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">json</span>
              </button>
              <button
                type="button"
                className="list-row w-full text-left"
                onClick={() => download.mutate({ data: { format: "csv" } })}
              >
                <span>
                  <span className="block text-sm font-medium">
                    Daily practices
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Salah, adhkar and istighfar records
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">csv</span>
              </button>
            </div>
          </section>
          <ResetSection
            onDone={async () => {
              await queryClient.invalidateQueries({ queryKey: nasrKeys.all });
              await queryClient.invalidateQueries({ queryKey: nasrKeys.home });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ResetSection({ onDone }: { onDone: () => Promise<void> }) {
  const reset = useMutation({
    mutationFn: () => resetNasr({ data: { confirm: "RESET" } }),
    onSuccess: () => {
      void onDone();
    },
  });
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  if (reset.isSuccess) {
    const cleared = Object.entries(reset.data.deleted).filter(([, n]) => n > 0);
    return (
      <section className="space-y-2">
        <h2 className="section-label">Danger zone</h2>
        <div className="list">
          <div className="list-row flex-col items-start gap-2 py-4">
            <p className="text-sm font-medium">Reset complete.</p>
            <p className="text-xs text-muted-foreground">
              {cleared.length === 0
                ? "There was nothing logged to delete."
                : cleared
                    .map(([table, n]) => `${table.replace(/_/g, " ")}: ${n}`)
                    .join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground">
              Backup written to{" "}
              <code className="font-mono">{reset.data.backup_path}</code>.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3"
              onClick={() => {
                setConfirming(false);
                setTyped("");
                reset.reset();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <h2 className="section-label">Danger zone</h2>
      <div className="list">
        <div className="list-row">
          <span>
            <span className="block text-sm font-medium">Reset all data</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              Deletes all practice history. Settings stay.
            </span>
          </span>
          {!confirming && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              Reset…
            </Button>
          )}
        </div>
        {confirming && (
          <div className="space-y-3 py-4">
            <p className="text-xs text-muted-foreground">
              A backup is written first. Type RESET to confirm.
            </p>
            <Input
              value={typed}
              spellCheck={false}
              autoComplete="off"
              placeholder="RESET"
              className="font-mono"
              onChange={(event) => setTyped(event.target.value)}
            />
            {reset.isError && (
              <p className="text-xs text-negative">
                Reset failed. Nothing was deleted.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={typed !== "RESET" || reset.isPending}
                onClick={() => reset.mutate()}
              >
                {reset.isPending ? "Resetting…" : "Delete everything"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={reset.isPending}
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_260px] sm:items-center sm:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

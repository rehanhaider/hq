import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Check,
  CircleAlert,
  FolderGit2,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "./DataTable";
import { ImportPanel } from "./ImportPanel";
import { connectionQuery, connectionsQuery } from "@/queries/dashboard";
import { removeConnection } from "@/server/fns";
import { connectionSummary } from "@/lib/connections";
import type { ConnectionRow } from "@/lib/connections";
import { daysAgo } from "@/lib/model";
import { utcStamp } from "@/lib/activity";
import { deenKeys } from "@/queries/deen";

const number = (n: number) => n.toLocaleString("en-US");
const emptyRows: ConnectionRow[] = [];
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  tableMeta: {} as { busy: boolean },
  columnMeta: {} as { className?: string },
});
const helper = createColumnHelper<typeof features, ConnectionRow>();
const columns = helper.columns([
  helper.accessor("fullName", {
    header: "Repository",
    cell: ({ row }) => (
      <>
        <p className="font-medium">{row.original.fullName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.original.private ? "Private" : "Public"}
          {row.original.language ? ` · ${row.original.language}` : ""}
        </p>
        {row.original.error ? (
          <p className="mt-1 max-w-md text-xs leading-relaxed text-negative">
            {row.original.error}
          </p>
        ) : null}
      </>
    ),
  }),
  helper.accessor("connection", {
    header: "Connection",
    enableSorting: true,
    meta: { className: "w-[1%]" },
    cell: ({ getValue }) => <ConnectionBadge state={getValue()} />,
  }),
  helper.accessor((row) => row.metrics.commits.ready, {
    id: "commits",
    header: "Commits",
    meta: { className: "w-[1%] text-right font-mono" },
    cell: ({ getValue }) => number(getValue()),
  }),
  helper.accessor((row) => row.metrics.pullRequests.ready, {
    id: "requests",
    header: "Requests",
    meta: { className: "w-[1%] text-right font-mono" },
    cell: ({ getValue }) => number(getValue()),
  }),
  helper.accessor((row) => row.metrics.additions + row.metrics.deletions, {
    id: "lines",
    header: "Lines + / −",
    meta: { className: "w-[1%] text-right font-mono whitespace-nowrap" },
    cell: ({ row }) => (
      <>
        <span className="text-positive">
          +{number(row.original.metrics.additions)}
        </span>
        <span className="ml-3 text-negative">
          −{number(row.original.metrics.deletions)}
        </span>
      </>
    ),
  }),
  helper.accessor((row) => row.lastSuccessAt ?? "", {
    id: "fetched",
    header: "Last fetched (UTC)",
    meta: {
      className: "w-[1%] text-right whitespace-nowrap text-muted-foreground",
    },
    cell: ({ row }) =>
      row.original.lastSuccessAt
        ? utcStamp(row.original.lastSuccessAt)
        : "Never",
  }),
  helper.display({
    id: "remove",
    header: () => <span className="sr-only">Remove</span>,
    meta: { className: "w-[1%] text-right" },
    cell: ({ row, table }) => (
      <RemoveCell row={row.original} busy={table.options.meta?.busy ?? false} />
    ),
  }),
]);

export function Connections({ importing }: { importing: boolean }) {
  const github = useQuery(connectionQuery);
  const connections = useQuery(connectionsQuery);
  const rows = connections.data?.repositories ?? [];
  const historyStart = rows
    .map((row) => row.since)
    .sort()
    .at(0);
  const lastFetched = rows
    .map((row) => row.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const [showAdd, setShowAdd] = useState(() => rows.length === 0);
  const [org, setOrg] = useState("all");
  const orgs = [
    ...new Set(rows.map((row) => row.fullName.split("/")[0] ?? row.fullName)),
  ].sort();

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Repositories</h1>
          <p className="page-description">
            Add or remove repositories. See fetch status and how much is stored.
          </p>
        </div>
        <Button
          size="lg"
          variant="default"
          onClick={() => setShowAdd((open) => !open)}
          aria-expanded={showAdd}
        >
          <Plus />
          Add repositories
        </Button>
      </div>

      <section className="list-row hairline flex-wrap pt-3">
        <h2 className="section-label">GitHub account</h2>
        {github.isPending ? (
          <p className="text-sm text-muted-foreground">Checking token…</p>
        ) : github.data?.connected ? (
          <p className="flex items-center gap-2 text-sm">
            <Check className="size-3.5 text-positive" />
            Connected as @{github.data.login}
          </p>
        ) : (
          <p
            className="flex min-w-0 items-start gap-2 text-sm text-negative"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {github.data?.error ?? github.error?.message ?? "Not connected."}
          </p>
        )}
      </section>

      {showAdd && (
        <ImportPanel
          defaultSince={historyStart?.slice(0, 10) ?? daysAgo(365)}
          savedFrom={historyStart?.slice(0, 10)}
          lastFetched={lastFetched}
          imported={rows.map((row) => row.fullName)}
          busy={importing}
          onClose={() => setShowAdd(false)}
        />
      )}

      {connections.isPending ? (
        <p className="text-sm text-muted-foreground">Loading repositories…</p>
      ) : connections.error ? (
        <p role="alert" className="text-sm text-negative">
          {connections.error.message}
        </p>
      ) : !rows.length ? (
        <div className="hairline flex min-h-48 flex-col items-center justify-center px-5 py-12 text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-muted">
            <FolderGit2 className="size-5 text-muted-foreground" />
          </span>
          <h2 className="font-semibold">No repositories yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Add the repositories you work on. HQ fetches commits and merged
            requests, then keeps them current.
          </p>
        </div>
      ) : (
        <ProjectTable
          rows={rows}
          org={org}
          orgs={orgs}
          onOrgChange={setOrg}
          busy={importing}
        />
      )}
    </div>
  );
}

function ProjectTable({
  rows,
  org,
  orgs,
  onOrgChange,
  busy,
}: {
  rows: ConnectionRow[];
  org: string;
  orgs: string[];
  onOrgChange: (org: string) => void;
  busy: boolean;
}) {
  const data = useMemo(
    () =>
      org === "all"
        ? rows
        : rows.filter((row) => row.fullName.startsWith(`${org}/`)),
    [org, rows],
  );
  const summary = connectionSummary(rows);
  const shown = connectionSummary(data);
  const table = useTable({
    features,
    columns,
    data: data.length ? data : emptyRows,
    getRowId: (row) => row.fullName,
    initialState: { sorting: [{ id: "commits", desc: true }] },
    meta: { busy },
  });
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-3">
        <div className="flex items-center gap-2">
          <Label
            htmlFor="org-filter"
            className="text-xs font-normal text-muted-foreground"
          >
            Filter by organization
          </Label>
          <select
            id="org-filter"
            className="field"
            value={org}
            onChange={(event) => onOrgChange(event.target.value)}
          >
            <option value="all">All</option>
            {orgs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            {data.length === rows.length
              ? `${summary.repositories} repositories`
              : `${data.length} of ${summary.repositories} repositories`}
          </span>
          <span
            className="inline-flex items-center gap-1"
            title={`${shown.connected} connected`}
          >
            <Check className="size-3 text-positive" aria-hidden />
            <span className="sr-only">Connected</span>
            {shown.connected}
          </span>
          {shown.syncing ? (
            <span
              className="inline-flex items-center gap-1"
              title={`${shown.syncing} fetching`}
            >
              <LoaderCircle className="size-3 animate-spin" aria-hidden />
              <span className="sr-only">Fetching</span>
              {shown.syncing}
            </span>
          ) : null}
          {shown.failed ? (
            <span
              className="inline-flex items-center gap-1 text-negative"
              title={`${shown.failed} failed`}
            >
              <CircleAlert className="size-3" aria-hidden />
              <span className="sr-only">Failed</span>
              {shown.failed}
            </span>
          ) : null}
        </p>
      </div>
      <DataTable
        table={table}
        empty={
          <p className="py-6 text-muted-foreground">No repositories match.</p>
        }
      />
    </section>
  );
}

function RemoveCell({ row, busy }: { row: ConnectionRow; busy: boolean }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation({
    mutationFn: () => removeConnection({ data: { repository: row.fullName } }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["connections"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
        client.invalidateQueries({ queryKey: deenKeys.home }),
      ]);
    },
  });
  return confirm ? (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.isPending}
        onClick={() => setConfirm(false)}
      >
        Keep
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={mutation.isPending || busy}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Removing…" : "Remove"}
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground"
      disabled={busy || row.connection === "syncing"}
      aria-label={`Remove ${row.fullName}`}
      onClick={() => setConfirm(true)}
    >
      Remove
    </Button>
  );
}

function ConnectionBadge({ state }: { state: ConnectionRow["connection"] }) {
  if (state === "syncing")
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <LoaderCircle className="size-3 animate-spin" />
        Fetching
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1.5 text-negative">
        <CircleAlert className="size-3" />
        Failed
      </span>
    );
  if (state === "ok")
    return (
      <span className="inline-flex items-center gap-1.5 text-positive">
        <Check className="size-3" />
        Connected
      </span>
    );
  return <span className="text-muted-foreground">Unknown</span>;
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Check, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectionQuery, repositoriesQuery } from "@/queries/dashboard";
import { beginImport } from "@/server/fns";
import { daysAgo, importSchema } from "@/lib/model";
import { utcDay, utcStamp } from "@/lib/activity";

export function ImportPanel({
  defaultSince,
  savedFrom,
  lastFetched,
  imported,
  busy,
  onClose,
}: {
  defaultSince: string;
  savedFrom?: string;
  lastFetched?: string;
  imported: string[];
  busy: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const connection = useQuery(connectionQuery);
  const repositories = useQuery({
    ...repositoriesQuery,
    enabled: connection.data?.connected === true,
  });
  const [selected, setSelected] = useState(new Set(imported));
  const [since, setSince] = useState(defaultSince);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [validation, setValidation] = useState("");
  const mutation = useMutation({
    mutationFn: beginImport,
    onSuccess: async (result) => {
      if (result.ok) {
        await client.invalidateQueries({ queryKey: ["import-status"] });
        onClose();
      }
    },
  });
  const repos = repositories.data?.ok ? repositories.data.repositories : [];
  const owners = [
    ...new Set(repos.map((repo) => repo.fullName.split("/")[0]!)),
  ].sort();
  const visible = repos.filter(
    (r) =>
      (owner === "all" || r.fullName.split("/")[0] === owner) &&
      r.fullName.toLowerCase().includes(search.toLowerCase()),
  );
  const allShownSelected =
    visible.length > 0 && visible.every((repo) => selected.has(repo.fullName));
  const error =
    validation ||
    (mutation.data && !mutation.data.ok ? mutation.data.error : "") ||
    mutation.error?.message;
  return (
    <section className="panel p-5" aria-labelledby="import-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="import-heading" className="section-title">
            {imported.length ? "Add repositories" : "Import your activity"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {imported.length
              ? "Pick more repositories. Already stored history stays put."
              : "Select repositories and how far back to store. Your token stays on the server."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close import settings"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {connection.isPending ? (
        <p className="mt-4 text-muted-foreground">
          Checking GitHub connection…
        </p>
      ) : connection.error ? (
        <p className="mt-4 text-negative" role="alert">
          {connection.error.message}
        </p>
      ) : connection.data && !connection.data.connected ? (
        <div className="mt-4 rounded-lg bg-muted p-4">
          <p>{connection.data.error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Startup commands are in README.md. Never paste a token into this
            page.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2 text-xs text-positive">
            <Check className="size-3.5" /> Connected as @
            {connection.data?.login}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_200px]">
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="repo-owner">Organization or owner</Label>
                  <select
                    id="repo-owner"
                    className="field mt-2 w-full"
                    value={owner}
                    onChange={(event) => setOwner(event.target.value)}
                  >
                    <option value="all">
                      All organizations and personal repos
                    </option>
                    {owners.map((name) => (
                      <option key={name} value={name}>
                        {name} ·{" "}
                        {
                          repos.filter(
                            (repo) => repo.fullName.split("/")[0] === name,
                          ).length
                        }
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="repo-search">Repositories</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      id="repo-search"
                      className="pl-9"
                      placeholder="Find a repository…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {selected.size} selected · showing {visible.length} of{" "}
                  {repos.length} accessible
                </span>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!visible.length || busy || allShownSelected}
                    onClick={() =>
                      setSelected(
                        (previous) =>
                          new Set([
                            ...previous,
                            ...visible.map((repo) => repo.fullName),
                          ]),
                      )
                    }
                  >
                    {allShownSelected
                      ? `All ${visible.length} selected`
                      : `Select all ${visible.length}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selected.size || busy}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </Button>
                </div>
              </div>
              <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border p-1">
                {repositories.isPending ? (
                  <p className="p-3 text-muted-foreground">
                    Loading repositories…
                  </p>
                ) : repositories.error ||
                  (repositories.data && !repositories.data.ok) ? (
                  <p role="alert" className="p-3 text-negative">
                    {repositories.error?.message ??
                      (repositories.data && !repositories.data.ok
                        ? repositories.data.error
                        : "")}
                  </p>
                ) : !visible.length ? (
                  <p className="p-3 text-muted-foreground">
                    No repositories match.
                  </p>
                ) : (
                  visible.map((repo) => (
                    <label
                      key={repo.id}
                      className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.has(repo.fullName)}
                        disabled={busy}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (next.has(repo.fullName))
                              next.delete(repo.fullName);
                            else next.add(repo.fullName);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 break-all text-xs">
                        {repo.fullName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {repo.private ? "Private" : "Public"}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="import-since">
                {imported.length ? "Older history from" : "Start of history"}
              </Label>
              <Input
                id="import-since"
                type="date"
                className="mt-2"
                max={daysAgo(0)}
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
              {savedFrom && lastFetched ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  You already have {utcDay(savedFrom)} through now. Last
                  fetched {utcStamp(lastFetched)} UTC. The 1W–1Y chart range is
                  a view, not this date. Change this only to reach before{" "}
                  {utcDay(savedFrom)}, or when adding a repository.
                </p>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  HQ stores commits from this day through today, then keeps
                  them current. The chart range is a separate view.
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Large histories can take several minutes. Keep the app server
                running; you can close this panel.
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-negative">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              disabled={
                busy ||
                mutation.isPending ||
                !selected.size ||
                repositories.isPending
              }
              size="lg"
              onClick={() => {
                const parsed = importSchema.safeParse({
                  repositories: [...selected],
                  since,
                });
                if (!parsed.success) {
                  setValidation(
                    parsed.error.issues[0]?.message ??
                      "Check the import settings.",
                  );
                  return;
                }
                setValidation("");
                mutation.mutate({ data: parsed.data });
              }}
            >
              {mutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowDownToLine />
              )}
              {mutation.isPending
                ? "Starting…"
                : `Import ${selected.size || ""} ${selected.size === 1 ? "repository" : "repositories"}`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

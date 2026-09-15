import { createFileRoute } from "@tanstack/react-router";
import { searchSchema } from "@/lib/model";
import {
  connectionsQuery,
  dashboardQuery,
  openWorkQuery,
} from "@/queries/dashboard";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/github")({
  validateSearch: searchSchema,
  staticData: {
    crumbs: (search) => [
      { label: "GitHub", search: { ...search, view: "overview" } },
    ],
    views: ({ search }) => {
      const current = search.view as string | undefined;
      return [
        { label: "Overview", view: "overview" },
        { label: "Statistics", view: "statistics" },
        { label: "Work", view: "work" },
        { label: "Repositories", view: "projects" },
      ].map(({ label, view }) => ({
        label,
        to: "/github",
        search: { ...search, view, page: 1 },
        active:
          current === view ||
          (view === "projects" && current === "connections"),
      }));
    },
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    if (deps.view === "connections" || deps.view === "projects")
      return context.queryClient.ensureQueryData(connectionsQuery);
    // Open work is a live GitHub sweep that can take tens of seconds when
    // the server has no copy yet. Start it, but never hold the page on it:
    // Work and Overview render their own placeholders while it arrives.
    void context.queryClient.prefetchQuery(openWorkQuery);
    if (deps.view === "work") return;
    return context.queryClient.ensureQueryData(dashboardQuery(deps));
  },
  component: Dashboard,
});

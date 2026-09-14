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
        { label: "Activity history", view: "history" },
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
    if (deps.view === "work")
      return context.queryClient.ensureQueryData(openWorkQuery);
    // The action Overview pairs live work with period figures, so it warms
    // both; Statistics and history only need the figures.
    if (deps.view === "overview")
      return Promise.all([
        context.queryClient.ensureQueryData(dashboardQuery(deps)),
        context.queryClient.ensureQueryData(openWorkQuery),
      ]);
    return context.queryClient.ensureQueryData(dashboardQuery(deps));
  },
  component: Dashboard,
});

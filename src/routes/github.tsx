import { createFileRoute } from "@tanstack/react-router";
import { searchSchema } from "@/lib/model";
import { connectionsQuery, dashboardQuery } from "@/queries/dashboard";
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
        { label: "Activity history", view: "history" },
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
  loader: ({ context, deps }) =>
    deps.view === "connections" || deps.view === "projects"
      ? context.queryClient.ensureQueryData(connectionsQuery)
      : context.queryClient.ensureQueryData(dashboardQuery(deps)),
  component: Dashboard,
});

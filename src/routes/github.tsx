import { createFileRoute } from "@tanstack/react-router";
import { searchSchema } from "@/lib/model";
import { connectionsQuery, dashboardQuery } from "@/queries/dashboard";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/github")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    deps.view === "connections" || deps.view === "projects"
      ? context.queryClient.ensureQueryData(connectionsQuery)
      : context.queryClient.ensureQueryData(dashboardQuery(deps)),
  component: Dashboard,
});

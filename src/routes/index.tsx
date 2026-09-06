import { createFileRoute } from "@tanstack/react-router";
import { searchSchema } from "@/lib/model";
import { dashboardQuery } from "@/queries/dashboard";
import { Dashboard } from "@/components/Dashboard";
export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(dashboardQuery(deps)),
  component: Dashboard,
});

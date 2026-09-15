import { createFileRoute } from "@tanstack/react-router";
import { dashboardQuery } from "@/queries/dashboard";
import { GithubStatistics } from "@/components/GithubStatistics";

export const Route = createFileRoute("/github/statistics")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(dashboardQuery(deps)),
  component: GithubStatistics,
});

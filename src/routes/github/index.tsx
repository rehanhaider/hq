import { createFileRoute } from "@tanstack/react-router";
import { dashboardQuery, openWorkQuery } from "@/queries/dashboard";
import { GithubOverview } from "@/components/GithubOverview";

export const Route = createFileRoute("/github/")({
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    // Open work is a live GitHub sweep that can take tens of seconds when
    // the server has no copy yet. Start it, but never hold the page on it:
    // the Overview renders placeholders for it while it arrives.
    void context.queryClient.prefetchQuery(openWorkQuery);
    return context.queryClient.ensureQueryData(dashboardQuery(deps));
  },
  component: () => <GithubOverview filters={Route.useSearch()} />,
});

import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyGithubPaths, legacyGithubView, searchSchema } from "@/lib/model";
import { GithubLayout } from "@/components/GithubLayout";

/**
 * The GitHub module. The date range and repository filter live here as
 * search parameters so they carry across Overview and Statistics; each view
 * is a child route and loads only what it shows.
 */
export const Route = createFileRoute("/github")({
  validateSearch: searchSchema.extend({ view: legacyGithubView }),
  beforeLoad: ({ search }) => {
    if (!search.view) return;
    const { view, ...rest } = search;
    throw redirect({ to: legacyGithubPaths[view], search: rest, replace: true });
  },
  staticData: {
    crumbs: "GitHub",
    views: ({ search, pathname }) => {
      const path = pathname.replace(/\/$/, "");
      const { view: _legacy, ...rest } = search;
      return [
        { label: "Overview", to: "/github" },
        { label: "Statistics", to: "/github/statistics" },
        { label: "Work", to: "/github/work" },
        { label: "Repositories", to: "/github/repositories" },
      ].map((view) => ({
        ...view,
        search: { ...rest, page: 1 },
        active: path === view.to,
      }));
    },
  },
  component: GithubLayout,
});

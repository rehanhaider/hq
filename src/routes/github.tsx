import { createFileRoute } from "@tanstack/react-router";
import { searchSchema } from "@/lib/model";
import { GithubLayout } from "@/components/GithubLayout";

/**
 * The GitHub module. The date range and repository filter live here as
 * search parameters so they carry across Overview and Statistics; each view
 * is a child route and loads only what it shows.
 */
export const Route = createFileRoute("/github")({
  validateSearch: searchSchema,
  staticData: {
    crumbs: "GitHub",
    views: ({ search, pathname }) => {
      const path = pathname.replace(/\/$/, "");
      return [
        { label: "Overview", to: "/github" },
        { label: "Statistics", to: "/github/statistics" },
        { label: "Work", to: "/github/work" },
        { label: "Repositories", to: "/github/repositories" },
      ].map((view) => ({
        ...view,
        search: { ...search, page: 1 },
        active: path === view.to,
      }));
    },
  },
  component: GithubLayout,
});

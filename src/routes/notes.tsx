import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

/**
 * Notes became Content. Old links — including anything bookmarked with a page
 * or a search on it — land on the same view under the new path.
 */
export const Route = createFileRoute("/notes")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `${location.pathname.replace(/^\/notes/, "/content")}${location.searchStr}`,
      replace: true,
    });
  },
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { contentSearchSchema } from "@/lib/content";

export const Route = createFileRoute("/content")({
  validateSearch: contentSearchSchema,
  staticData: {
    crumbs: (search) => [
      { label: "Content", search: { ...search, page: undefined } },
    ],
    views: ({ search, pathname }) => {
      const path = pathname.replace(/\/$/, "");
      // Filters travel between views; the open page does not, because only
      // Pages has one.
      const shared = { ...search, page: undefined };
      return [
        {
          label: "Pages",
          to: "/content",
          search,
          active: path === "/content",
        },
        {
          label: "Board",
          to: "/content/board",
          search: shared,
          active: path === "/content/board",
        },
        {
          label: "Trash",
          to: "/content/trash",
          search: shared,
          active: path === "/content/trash",
        },
        {
          label: "Settings",
          to: "/content/settings",
          search: shared,
          active: path === "/content/settings",
        },
      ];
    },
  },
  component: () => <Outlet />,
});

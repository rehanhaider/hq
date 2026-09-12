import { createFileRoute, Outlet } from "@tanstack/react-router";
import { notesSearchSchema } from "@/lib/notes";

export const Route = createFileRoute("/notes")({
  validateSearch: notesSearchSchema,
  staticData: {
    crumbs: (search) => [
      { label: "Notes", search: { q: search.q, page: undefined } },
    ],
    views: ({ search, pathname }) => {
      const path = pathname.replace(/\/$/, "");
      return [
        {
          label: "Pages",
          to: "/notes",
          search: { q: search.q, page: search.page },
          active: path === "/notes",
        },
        {
          label: "Trash",
          to: "/notes/trash",
          search: { q: search.q, page: undefined },
          active: path === "/notes/trash",
        },
      ];
    },
  },
  component: () => <Outlet />,
});

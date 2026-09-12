import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { notesSearchSchema } from "@/lib/notes";

export const Route = createFileRoute("/notes")({
  validateSearch: notesSearchSchema,
  component: NotesLayout,
});

function NotesLayout() {
  const path = useLocation().pathname.replace(/\/$/, "");
  return (
    <div className="space-y-6">
      <nav aria-label="Notes pages" className="section-tabs">
        <Link
          to="/notes"
          search={{ q: undefined, page: undefined }}
          activeOptions={{ exact: true }}
          aria-current={path === "/notes" ? "page" : undefined}
          className="section-tab"
        >
          Pages
        </Link>
        <Link
          to="/notes/trash"
          search={{ q: undefined, page: undefined }}
          activeOptions={{ exact: true }}
          aria-current={path === "/notes/trash" ? "page" : undefined}
          className="section-tab"
        >
          Trash
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

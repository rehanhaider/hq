import { Link, useLocation, useMatches, type LinkProps } from "@tanstack/react-router";
import { trailFromMatches } from "@/lib/breadcrumbs";

/**
 * The page navigation of the module the browser is in: Today · Progress ·
 * Settings, Pages · Board · Trash · Settings, and so on. Sibling views are
 * siblings, so they sit in a row where all of them can be seen, rather than
 * inside a menu that has to be opened before it says what is in it.
 */
export function ModuleTabs() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const { views } = trailFromMatches(matches, pathname);
  if (views.length === 0) return null;
  return (
    <nav
      aria-label="Module views"
      className="section-tabs gap-5 px-4 md:px-6 lg:px-8"
    >
      {views.map((view) => (
        <Link
          key={`${view.to}-${view.label}`}
          className="section-tab"
          aria-current={view.active ? "page" : undefined}
          {...({ to: view.to, search: view.search } as LinkProps)}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}

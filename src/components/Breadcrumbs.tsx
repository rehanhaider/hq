import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useMatches,
  type LinkProps,
} from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import {
  notePath,
  trailFromMatches,
  type Crumb,
  type ViewOption,
} from "@/lib/breadcrumbs";
import { notesQuery } from "@/queries/notes";

/** The crumbs and sibling views for the current location. */
function useTrail() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const trail = trailFromMatches(matches, pathname);
  // The selected Notes page is a search parameter rather than a route, so its
  // own hierarchy is read from the page tree instead of the matched routes.
  const notes = matches.find((match) => match.routeId === "/notes/");
  const pageId = (notes?.search as { page?: string } | undefined)?.page;
  const pages = useQuery({ ...notesQuery(), enabled: Boolean(pageId) });
  const crumbs: Crumb[] = [...trail.crumbs];
  if (pageId)
    crumbs.push(
      ...notePath(pages.data ?? [], pageId).map((page) => ({
        label: page.title,
        to: "/notes",
        search: { page: page.id },
      })),
    );
  return { ...trail, crumbs };
}

function linkProps(target: { to: string; search?: Record<string, unknown> }) {
  return { to: target.to, search: target.search } as LinkProps;
}

function ViewSwitcher({ views }: { views: ViewOption[] }) {
  const active = views.find((view) => view.active) ?? views[0];
  if (!active) return null;
  return (
    <Menu>
      <MenuTrigger className="inline-flex min-h-7 items-center gap-1 rounded-lg px-1.5 font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted">
        <span className="truncate">{active.label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuContent>
        {views.map((view) => (
          <MenuItem
            key={`${view.to}-${view.label}`}
            aria-current={view.active ? "page" : undefined}
            render={<Link {...linkProps(view)} />}
          >
            {view.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function Breadcrumbs() {
  const { crumbs, views, viewsAt } = useTrail();
  // Each entry is a crumb, or the view switcher sitting where its module does.
  const items: Array<Crumb | "views"> =
    views.length > 0
      ? [...crumbs.slice(0, viewsAt), "views", ...crumbs.slice(viewsAt)]
      : crumbs;

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment
              key={item === "views" ? "views" : `${index}-${item.label}`}
            >
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {item === "views" ? (
                  <ViewSwitcher views={views} />
                ) : last ? (
                  <BreadcrumbPage className="truncate">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
                    render={<Link {...linkProps({ ...item, to: item.to! })} />}
                  >
                    {item.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

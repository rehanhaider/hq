import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useMatches,
  type LinkProps,
} from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { pagePath, trailFromMatches, type Crumb } from "@/lib/breadcrumbs";
import { pagesQuery } from "@/queries/content";

/** The crumbs and sibling views for the current location. */
function useTrail() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const trail = trailFromMatches(matches, pathname);
  // The selected Content page is a search parameter rather than a route, so its
  // own hierarchy is read from the page tree instead of the matched routes.
  const content = matches.find((match) => match.routeId === "/content/");
  const search = (content?.search ?? {}) as Record<string, unknown>;
  const pageId = search.page as string | undefined;
  const pages = useQuery({ ...pagesQuery(), enabled: Boolean(pageId) });
  const crumbs: Crumb[] = [...trail.crumbs];
  if (pageId)
    crumbs.push(
      ...pagePath(pages.data ?? [], pageId).map((page) => ({
        label: page.title,
        to: "/content",
        search: { ...search, page: page.id },
      })),
    );
  return { ...trail, crumbs };
}

function linkProps(target: { to: string; search?: Record<string, unknown> }) {
  return { to: target.to, search: target.search } as LinkProps;
}

export function Breadcrumbs() {
  // Sibling views are a tab row under the top bar, not a step in the trail.
  const { crumbs: items } = useTrail();

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${index}-${item.label}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {last ? (
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

import type { NotePage } from "@/lib/notes";

/**
 * One step of the hierarchy. `to` and `search` default to the route match that
 * contributed the crumb, so most routes only have to name themselves.
 */
export type Crumb = {
  label: string;
  to?: string;
  search?: Record<string, unknown>;
};

/** A sibling view of the module that owns it: a tab, or a switcher entry. */
export type ViewOption = {
  label: string;
  to: string;
  search?: Record<string, unknown>;
  active: boolean;
};

/** What a route contributes: a label, or crumbs derived from its search. */
export type RouteCrumbs =
  | string
  | ((search: Record<string, unknown>) => Crumb[]);

/** The sibling views a module offers, given where the browser currently is. */
export type RouteViews = (context: {
  search: Record<string, unknown>;
  pathname: string;
}) => ViewOption[];

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    crumbs?: RouteCrumbs;
    views?: RouteViews;
  }
}

type CrumbMatch = {
  fullPath: string;
  search: unknown;
  staticData?: { crumbs?: RouteCrumbs; views?: RouteViews };
};

export type Trail = {
  /** The hierarchy, outermost first. */
  crumbs: Crumb[];
  /** Sibling views of the innermost module that declares any. */
  views: ViewOption[];
  /** Where the current view sits in `crumbs`, for renderings that inline it. */
  viewsAt: number;
};

/**
 * Flattens the matched routes into a trail. Views are kept apart from the
 * crumbs: a view is a sibling of its neighbours, not a step below them.
 */
export function trailFromMatches(
  matches: CrumbMatch[],
  pathname: string,
): Trail {
  const crumbs: Crumb[] = [];
  let views: ViewOption[] = [];
  let viewsAt = 0;
  for (const match of matches) {
    const search = (match.search ?? {}) as Record<string, unknown>;
    const source = match.staticData?.crumbs;
    if (source) {
      const own =
        typeof source === "string" ? [{ label: source }] : source(search);
      for (const crumb of own)
        crumbs.push({
          ...crumb,
          to: crumb.to ?? match.fullPath,
          search: crumb.search ?? search,
        });
    }
    const declared = match.staticData?.views;
    if (declared) {
      views = declared({ search, pathname });
      viewsAt = crumbs.length;
    }
  }
  return { crumbs, views, viewsAt };
}

/** The page and its ancestors, outermost first. */
export function notePath(pages: NotePage[], id: string): NotePage[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const path: NotePage[] = [];
  const seen = new Set<string>();
  let page = byId.get(id);
  while (page && !seen.has(page.id)) {
    seen.add(page.id);
    path.unshift(page);
    page = page.parentId ? byId.get(page.parentId) : undefined;
  }
  return path;
}

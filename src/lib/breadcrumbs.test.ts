import { describe, expect, it } from "vitest";
import { pagePath, trailFromMatches } from "./breadcrumbs";
import type { ContentPage } from "./content";

const page = (id: string, title: string, parentId: string | null): ContentPage => ({
  id,
  title,
  parentId,
  order: 0,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  revision: 1,
  preview: "",
  statusId: null,
  typeIds: [],
  tagIds: [],
  subpageTypeIds: [],
  position: 0,
  pinned: false,
});

describe("trailFromMatches", () => {
  it("skips routes without a label and inherits the match path and search", () => {
    expect(
      trailFromMatches(
        [
          { fullPath: "/", search: {}, staticData: { crumbs: "HQ" } },
          {
            fullPath: "/content",
            search: { q: "plan" },
            staticData: { crumbs: "Content" },
          },
          { fullPath: "/content/", search: { q: "plan" }, staticData: {} },
        ],
        "/content",
      ),
    ).toEqual({
      crumbs: [
        { label: "HQ", to: "/", search: {} },
        { label: "Content", to: "/content", search: { q: "plan" } },
      ],
      views: [],
      viewsAt: 0,
    });
  });

  it("keeps sibling views out of the crumbs and records where they belong", () => {
    const trail = trailFromMatches(
      [
        { fullPath: "/", search: {}, staticData: { crumbs: "HQ" } },
        {
          fullPath: "/github",
          search: { view: "history" },
          staticData: {
            crumbs: (search) => [
              { label: "GitHub", search: { ...search, view: "overview" } },
            ],
            views: ({ search }) =>
              ["overview", "history"].map((view) => ({
                label: view,
                to: "/github",
                search: { ...search, view },
                active: search.view === view,
              })),
          },
        },
      ],
      "/github",
    );
    expect(trail.crumbs).toEqual([
      { label: "HQ", to: "/", search: {} },
      { label: "GitHub", to: "/github", search: { view: "overview" } },
    ]);
    expect(trail.viewsAt).toBe(2);
    expect(trail.views.map((view) => [view.label, view.active])).toEqual([
      ["overview", false],
      ["history", true],
    ]);
  });

  it("marks the active view from the current path", () => {
    const trail = trailFromMatches(
      [
        {
          fullPath: "/nasr",
          search: {},
          staticData: {
            views: ({ pathname }) =>
              [
                { label: "Today", to: "/nasr" },
                { label: "Progress", to: "/nasr/history" },
              ].map((view) => ({ ...view, active: pathname === view.to })),
          },
        },
      ],
      "/nasr/history",
    );
    expect(trail.crumbs).toEqual([]);
    expect(trail.views.find((view) => view.active)?.label).toBe("Progress");
  });
});

describe("pagePath", () => {
  const pages = [
    page("a", "Plans", null),
    page("b", "2026", "a"),
    page("c", "Week 1", "b"),
    page("d", "Orphan", "missing"),
  ];

  it("walks a page up to its root ancestor", () => {
    expect(pagePath(pages, "c").map((item) => item.title)).toEqual([
      "Plans",
      "2026",
      "Week 1",
    ]);
  });

  it("stops at a missing parent and on an unknown page", () => {
    expect(pagePath(pages, "d").map((item) => item.title)).toEqual(["Orphan"]);
    expect(pagePath(pages, "nope")).toEqual([]);
  });

  it("does not loop on a cycle", () => {
    const cyclic = [page("x", "X", "y"), page("y", "Y", "x")];
    expect(pagePath(cyclic, "x").map((item) => item.title)).toEqual(["Y", "X"]);
  });
});

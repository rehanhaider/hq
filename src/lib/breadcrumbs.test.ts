import { describe, expect, it } from "vitest";
import { notePath, trailFromMatches } from "./breadcrumbs";
import type { NotePage } from "./notes";

const page = (id: string, title: string, parentId: string | null): NotePage => ({
  id,
  title,
  parentId,
  order: 0,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  revision: 1,
  preview: "",
});

describe("trailFromMatches", () => {
  it("skips routes without a label and inherits the match path and search", () => {
    expect(
      trailFromMatches(
        [
          { fullPath: "/", search: {}, staticData: { crumbs: "HQ" } },
          {
            fullPath: "/notes",
            search: { q: "plan" },
            staticData: { crumbs: "Notes" },
          },
          { fullPath: "/notes/", search: { q: "plan" }, staticData: {} },
        ],
        "/notes",
      ),
    ).toEqual({
      crumbs: [
        { label: "HQ", to: "/", search: {} },
        { label: "Notes", to: "/notes", search: { q: "plan" } },
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
          fullPath: "/deen",
          search: {},
          staticData: {
            views: ({ pathname }) =>
              [
                { label: "Today", to: "/deen" },
                { label: "Progress", to: "/deen/history" },
              ].map((view) => ({ ...view, active: pathname === view.to })),
          },
        },
      ],
      "/deen/history",
    );
    expect(trail.crumbs).toEqual([]);
    expect(trail.views.find((view) => view.active)?.label).toBe("Progress");
  });
});

describe("notePath", () => {
  const pages = [
    page("a", "Plans", null),
    page("b", "2026", "a"),
    page("c", "Week 1", "b"),
    page("d", "Orphan", "missing"),
  ];

  it("walks a page up to its root ancestor", () => {
    expect(notePath(pages, "c").map((item) => item.title)).toEqual([
      "Plans",
      "2026",
      "Week 1",
    ]);
  });

  it("stops at a missing parent and on an unknown page", () => {
    expect(notePath(pages, "d").map((item) => item.title)).toEqual(["Orphan"]);
    expect(notePath(pages, "nope")).toEqual([]);
  });

  it("does not loop on a cycle", () => {
    const cyclic = [page("x", "X", "y"), page("y", "Y", "x")];
    expect(notePath(cyclic, "x").map((item) => item.title)).toEqual(["Y", "X"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  contentSearchSchema,
  contentSummary,
  DEFAULT_PAGE_TITLE,
  displayPageTitle,
  filterPages,
  groupPages,
  hasFilters,
  persistedPageTitle,
  relativeTime,
  sortPages,
  type ContentPage,
  type ContentProperties,
} from "./content";

const page = (
  title: string,
  overrides: Partial<ContentPage> = {},
): ContentPage => ({
  id: title.toLowerCase(),
  title,
  parentId: null,
  order: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  revision: 0,
  preview: "",
  statusId: "idea",
  typeIds: [],
  tagIds: [],
  position: 0,
  ...overrides,
});

const properties: ContentProperties = {
  statuses: [
    { id: "idea", name: "Idea", color: "slate", position: 0 },
    { id: "published", name: "Published", color: "green", position: 1 },
  ],
  types: [
    { id: "video", name: "YouTube video", color: "red", position: 0 },
    { id: "post", name: "Blog post", color: "blue", position: 1 },
  ],
  tags: [{ id: "sqlite", name: "sqlite", color: "blue", position: 0 }],
};

describe("filterPages", () => {
  const pages = [
    page("Stream plan", { typeIds: ["video"], tagIds: ["sqlite"] }),
    page("Blog draft", { statusId: "published" }),
  ];

  it("matches titles case-insensitively", () => {
    expect(filterPages(pages, { q: "STREAM" }).map((item) => item.title)).toEqual([
      "Stream plan",
    ]);
  });

  it("treats each list as any-of and the lists as all-of", () => {
    expect(filterPages(pages, { status: ["published"] }).map((item) => item.title)).toEqual([
      "Blog draft",
    ]);
    expect(
      filterPages(pages, { status: ["idea", "published"] }).map((item) => item.title),
    ).toEqual(["Stream plan", "Blog draft"]);
    expect(filterPages(pages, { status: ["idea"], type: ["video"] })).toHaveLength(1);
    expect(filterPages(pages, { status: ["published"], type: ["video"] })).toHaveLength(0);
    expect(filterPages(pages, { tag: ["sqlite"] }).map((item) => item.title)).toEqual([
      "Stream plan",
    ]);
  });

  it("matches a page carrying any of the selected types", () => {
    const crossover = page("Crossover", { typeIds: ["video", "post"] });
    expect(filterPages([crossover], { type: ["video"] })).toHaveLength(1);
    expect(filterPages([crossover], { type: ["post"] })).toHaveLength(1);
    expect(filterPages([crossover], { type: ["video", "post"] })).toHaveLength(1);
    expect(filterPages([crossover], { type: ["sqlite"] })).toHaveLength(0);
  });

  it("returns everything when nothing is selected", () => {
    expect(filterPages(pages, {})).toHaveLength(2);
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ tag: ["sqlite"] })).toBe(true);
    expect(hasFilters({ q: "  " })).toBe(false);
  });

  it("treats a blank stored title as Untitled when searching", () => {
    const untitled = page("", { id: "blank" });
    expect(filterPages([untitled], { q: "untitled" }).map((item) => item.id)).toEqual([
      "blank",
    ]);
  });
});

describe("sortPages", () => {
  const pages = [
    page("Beta", { position: 2, updatedAt: "2026-03-01T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z" }),
    page("Alpha", { position: 1, updatedAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-01-05T00:00:00.000Z" }),
  ];

  it("orders manually, then by recency, then by title", () => {
    expect(sortPages(pages, "manual").map((item) => item.title)).toEqual(["Alpha", "Beta"]);
    expect(sortPages(pages, "updated").map((item) => item.title)).toEqual(["Beta", "Alpha"]);
    expect(sortPages(pages, "created").map((item) => item.title)).toEqual(["Alpha", "Beta"]);
    expect(sortPages(pages, "title").map((item) => item.title)).toEqual(["Alpha", "Beta"]);
  });

  it("does not modify the given list", () => {
    const original = [...pages];
    sortPages(pages, "title");
    expect(pages).toEqual(original);
  });
});

describe("groupPages", () => {
  const pages = [
    page("Stream plan", { typeIds: ["video"], tagIds: ["sqlite"] }),
    page("Blog draft", { statusId: "published" }),
  ];

  it("keeps every status column, in the configured order", () => {
    expect(
      groupPages(pages, "status", properties).map((bucket) => [
        bucket.label,
        bucket.pages.length,
      ]),
    ).toEqual([
      ["Idea", 1],
      ["Published", 1],
    ]);
  });

  it("adds a trailing bucket for pages without a type or tag", () => {
    expect(groupPages(pages, "type", properties).map((bucket) => bucket.label)).toEqual([
      "YouTube video",
      "Blog post",
      "No type",
    ]);
    expect(groupPages(pages, "tag", properties).map((bucket) => bucket.label)).toEqual([
      "sqlite",
      "Untagged",
    ]);
    expect(
      groupPages([pages[0]!], "tag", properties).map((bucket) => bucket.label),
    ).toEqual(["sqlite"]);
  });

  it("shows a page with two types in both type columns", () => {
    const crossover = page("Crossover", { typeIds: ["video", "post"] });
    const buckets = groupPages([crossover], "type", properties);
    expect(buckets[0]!.pages.map((item) => item.title)).toEqual(["Crossover"]);
    expect(buckets[1]!.pages.map((item) => item.title)).toEqual(["Crossover"]);
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      "YouTube video",
      "Blog post",
    ]);
  });

  it("hides empty columns on request", () => {
    const empty = groupPages([pages[0]!], "status", properties, { hideEmpty: true });
    expect(empty.map((bucket) => bucket.label)).toEqual(["Idea"]);
  });
});

describe("page title placeholder", () => {
  it("stores a blank editor title as empty rather than the default label", () => {
    expect(persistedPageTitle("")).toBe("");
    expect(persistedPageTitle("  ")).toBe("");
    expect(persistedPageTitle("Stream plan")).toBe("Stream plan");
    expect(persistedPageTitle("  Stream plan  ")).toBe("Stream plan");
    expect(persistedPageTitle(DEFAULT_PAGE_TITLE)).toBe(DEFAULT_PAGE_TITLE);
  });

  it("uses the default only as a list label and editor placeholder", () => {
    expect(displayPageTitle("")).toBe(DEFAULT_PAGE_TITLE);
    expect(displayPageTitle("  ")).toBe(DEFAULT_PAGE_TITLE);
    expect(displayPageTitle("Stream plan")).toBe("Stream plan");
    expect(displayPageTitle(DEFAULT_PAGE_TITLE)).toBe(DEFAULT_PAGE_TITLE);
  });
});

describe("contentSearchSchema", () => {
  it("keeps a bookmarked board and drops anything unusable", () => {
    expect(
      contentSearchSchema.parse({
        q: " stream ",
        status: ["3f1b0a2e-1c4d-4b8e-9f6a-2d5c7e8f9a0b"],
        group: "type",
        sort: "updated",
        columns: "filled",
      }),
    ).toMatchObject({
      q: "stream",
      status: ["3f1b0a2e-1c4d-4b8e-9f6a-2d5c7e8f9a0b"],
      group: "type",
      sort: "updated",
      columns: "filled",
    });
    expect(
      contentSearchSchema.parse({ group: "nonsense", sort: "nonsense", tag: ["nope"] }),
    ).toEqual({ group: undefined, sort: undefined, tag: undefined });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-03-10T12:00:00.000Z");
  it("shortens recent timestamps and falls back to a date", () => {
    expect(relativeTime("2026-03-10T11:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-03-10T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeTime("2026-03-10T06:00:00.000Z", now)).toBe("6h ago");
    expect(relativeTime("2026-03-08T12:00:00.000Z", now)).toBe("2d ago");
    expect(relativeTime("2026-02-24T12:00:00.000Z", now)).toBe("2w ago");
    expect(relativeTime("2025-11-01T12:00:00.000Z", now)).toBe("2025-11-01");
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("contentSummary", () => {
  const pages = [
    page("Stream plan", {
      id: "a",
      typeIds: ["video"],
      updatedAt: "2026-09-10T09:00:00.000Z",
    }),
    page("Blog draft", {
      id: "b",
      statusId: "published",
      updatedAt: "2026-09-12T09:00:00.000Z",
    }),
    page("Loose page", {
      id: "c",
      statusId: null,
      updatedAt: "2026-09-11T09:00:00.000Z",
    }),
  ];

  it("counts every status in the order Settings gives them", () => {
    const summary = contentSummary(pages, properties);
    expect(summary.total).toBe(3);
    expect(summary.counts.map((entry) => [entry.name, entry.count])).toEqual([
      ["Idea", 1],
      ["Published", 1],
      ["No status", 1],
    ]);
  });

  it("leaves out the no-status bucket when every page has one", () => {
    const summary = contentSummary(pages.slice(0, 2), properties);
    expect(summary.counts.map((entry) => entry.name)).toEqual([
      "Idea",
      "Published",
    ]);
  });

  it("lists the most recently touched pages first, with their properties", () => {
    const summary = contentSummary(pages, properties, 2);
    expect(summary.recent.map((entry) => entry.title)).toEqual([
      "Blog draft",
      "Loose page",
    ]);
    expect(summary.recent[0]).toMatchObject({
      status: "Published",
      statusColor: "green",
      type: null,
    });
    expect(contentSummary(pages, properties).recent[2]).toMatchObject({
      title: "Stream plan",
      type: "YouTube video",
      status: "Idea",
    });
  });

  it("summarises an empty pipeline without inventing rows", () => {
    const summary = contentSummary([], properties);
    expect(summary.total).toBe(0);
    expect(summary.recent).toEqual([]);
    expect(summary.counts.every((entry) => entry.count === 0)).toBe(true);
  });

  it("joins more than one type in the recent list", () => {
    const crossover = page("Crossover", {
      id: "d",
      typeIds: ["video", "post"],
      updatedAt: "2026-09-13T09:00:00.000Z",
    });
    const summary = contentSummary([crossover], properties, 1);
    expect(summary.recent[0]).toMatchObject({
      title: "Crossover",
      type: "YouTube video, Blog post",
    });
  });
});

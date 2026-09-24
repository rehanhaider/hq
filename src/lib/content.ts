import { z } from "zod";
import { EMBED_BLOCK_TYPES, embedMatchers } from "./embedPaste";
import { linkPreviewUrl } from "./linkPreview";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ContentBlock = { [key: string]: JsonValue };

/** The three property lists a top-level page is described by. */
export const PAGE_PROPERTY_KINDS = ["status", "type", "tag"] as const;
export type PagePropertyKind = (typeof PAGE_PROPERTY_KINDS)[number];

/**
 * Every configurable list. A subpage is not a page in the pipeline — it is one
 * piece of media under a page — so it carries its own single type from its own
 * list, kept apart from the page types so neither picker can offer the other's
 * entries.
 */
export const PROPERTY_KINDS = [...PAGE_PROPERTY_KINDS, "subpageType"] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

/**
 * A small fixed palette. Named rather than free-form so a colour always has a
 * readable pair in both themes, and so the stored value survives a restyle.
 */
export const PROPERTY_COLORS = [
  "slate",
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
] as const;
export type PropertyColor = (typeof PROPERTY_COLORS)[number];

/** One entry of a property list: a status, a type, or a tag. */
export type Property = {
  id: string;
  name: string;
  color: PropertyColor;
  position: number;
};

export type ContentProperties = {
  statuses: Property[];
  types: Property[];
  tags: Property[];
  /** What a subpage is: a website, a repository, a tweet, a picture, a video. */
  subpageTypes: Property[];
};

export type ContentPage = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  preview: string;
  statusId: string | null;
  typeIds: string[];
  tagIds: string[];
  /** A subpage's types, from the subpage list. Empty on a top-level page. */
  subpageTypeIds: string[];
  /** Manual order within a board column. */
  position: number;
  /** When true, the page sits above its unpinned siblings in the Pages index. */
  pinned: boolean;
};

export type PageDetail = ContentPage & {
  document: ContentBlock[];
};

/** A file attached to a page. The id is its content hash plus an extension. */
export type StoredUpload = {
  id: string;
  pageId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};

const idSchema = z.string().uuid();

/** Shown in lists and as the title field's placeholder when the stored title is empty. */
export const DEFAULT_PAGE_TITLE = "Untitled";

export const pageTitleSchema = z.string().trim().max(200);

/** Trimmed title to persist. Empty stays empty so it remains a placeholder. */
export function persistedPageTitle(title: string) {
  return title.trim();
}

/**
 * Title to keep in the editor after a save. Storage trims; the field waits
 * until the cursor leaves before matching.
 */
export function editorPageTitle(typed: string, persisted: string) {
  return persistedPageTitle(typed) === persisted ? typed : persisted;
}

/** Label for lists, crumbs, and cards when the stored title is empty. */
export function displayPageTitle(title: string) {
  return title.trim() || DEFAULT_PAGE_TITLE;
}

export const propertyNameSchema = z.string().trim().min(1).max(60);
export const propertyKindSchema = z.enum(PROPERTY_KINDS);
export const propertyColorSchema = z.enum(PROPERTY_COLORS);

/**
 * Splits a tag input into individual names. Commas, semicolons, and colons
 * all separate tags, so `foo, bar` or `foo;bar` becomes two tags. Each piece
 * is trimmed and empty pieces are dropped.
 */
export function splitTagNames(input: string): string[] {
  return input
    .split(/[,;:]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

export const SORTS = ["manual", "updated", "created", "title"] as const;
export type ContentSort = (typeof SORTS)[number];
export const GROUPS = PAGE_PROPERTY_KINDS;
export type ContentGroup = PagePropertyKind;

const idListSchema = z.array(idSchema).max(60).optional().catch(undefined);

/**
 * Every filter, sort, and grouping choice lives here so a board is a URL. All
 * of it is optional: an absent value is the default, which keeps links short.
 */
export const contentSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  page: idSchema.optional().catch(undefined),
  tree: idSchema.optional().catch(undefined),
  status: idListSchema,
  type: idListSchema,
  tag: idListSchema,
  group: z.enum(GROUPS).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  /** "filled" hides columns with no cards. */
  columns: z.enum(["all", "filled"]).optional().catch(undefined),
});

export type ContentSearch = z.infer<typeof contentSearchSchema>;

export const listPagesSchema = z.object({
  q: z.string().trim().max(200).optional(),
  trashed: z.boolean().optional().default(false),
});

export const createPageSchema = z.object({
  title: pageTitleSchema.optional().default(""),
  parentId: idSchema.nullable().optional().default(null),
  statusId: idSchema.nullable().optional().default(null),
  typeIds: z.array(idSchema).max(60).optional().default([]),
  tagIds: z.array(idSchema).max(60).optional().default([]),
  subpageTypeIds: z.array(idSchema).max(60).optional().default([]),
  document: z
    .custom<ContentBlock[]>(validateContentDocument, {
      message: "The page contains unsupported or invalid content.",
    })
    .optional(),
});

export const pageIdSchema = z.object({ id: idSchema });

export const changePageStateSchema = z.object({
  id: idSchema,
  revision: z.number().int().nonnegative(),
});

/**
 * Properties are saved on their own, without the document and without touching
 * the revision, so changing a status can never lose an open editor's text or
 * turn its next autosave into a conflict.
 */
export const setPagePropertiesSchema = z.object({
  id: idSchema,
  /** An id, or null to clear it. A subpage holds no status. */
  statusId: idSchema.nullable().optional(),
  typeIds: z.array(idSchema).max(60).optional(),
  tagIds: z.array(idSchema).max(60).optional(),
  /** The subpage's whole type list; empty clears it. Only a subpage carries one. */
  subpageTypeIds: z.array(idSchema).max(60).optional(),
});

/**
 * Pin is index layout, not a document edit: no revision, so an open editor
 * keeps saving against the revision it already holds.
 */
export const setPagePinnedSchema = z.object({
  id: idSchema,
  pinned: z.boolean(),
});

/**
 * One drag. The destination column is described by whichever grouping the board
 * is showing, and `orderedIds` is that column's final order, so the manual
 * sequence is rewritten from what the user actually sees.
 */
export const movePageCardSchema = z.object({
  id: idSchema,
  statusId: idSchema.optional(),
  addTypeId: idSchema.optional(),
  removeTypeId: idSchema.optional(),
  addTagId: idSchema.optional(),
  removeTagId: idSchema.optional(),
  /** The page's whole type list, for a drop that is not one type's worth. */
  typeIds: z.array(idSchema).max(60).optional(),
  /** The page's whole tag list, for a drop that is not one tag's worth. */
  tagIds: z.array(idSchema).max(60).optional(),
  orderedIds: z.array(idSchema).max(1_000).optional().default([]),
});

/**
 * One drag in the page index. `orderedIds` is the dragged page's sibling
 * group's final order, so the display sequence is rewritten from what the
 * user actually sees. The parent never changes here: nesting is out of scope.
 */
export const movePageSchema = z.object({
  id: idSchema,
  orderedIds: z.array(idSchema).max(1_000).optional().default([]),
});

export const createPropertySchema = z.object({
  kind: propertyKindSchema,
  name: propertyNameSchema,
  color: propertyColorSchema.optional(),
});

export const updatePropertySchema = z.object({
  kind: propertyKindSchema,
  id: idSchema,
  name: propertyNameSchema.optional(),
  color: propertyColorSchema.optional(),
});

export const reorderPropertiesSchema = z.object({
  kind: propertyKindSchema,
  ids: z.array(idSchema).min(1).max(200),
});

export const deletePropertySchema = z.object({
  kind: propertyKindSchema,
  id: idSchema,
  /** Where a deleted status sends its pages. */
  moveToId: idSchema.nullable().optional().default(null),
});

const supportedBlockTypes = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "table",
  "image",
  "video",
  "file",
  ...EMBED_BLOCK_TYPES,
]);
/** Blocks that hold a file rather than text: no inline content, a url instead. */
const fileBlockTypes = new Set(["image", "video", "file"]);
/** Blocks that hold a URL drawn as a card: no inline content either. */
const embedBlockTypes = new Set<string>(EMBED_BLOCK_TYPES);
const alignments = new Set(["left", "center", "right", "justify"]);
const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeLink(href: unknown) {
  if (typeof href !== "string" || href.length > 2_048 || href.trim() !== href)
    return false;
  try {
    return allowedProtocols.has(new URL(href, "https://hq.local").protocol);
  } catch {
    return false;
  }
}

function validateStyles(value: unknown) {
  if (!isObject(value) || !hasOnlyKeys(value, ["bold", "italic", "underline"]))
    return false;
  return Object.values(value).every((item) => typeof item === "boolean");
}

function validateStyledText(value: unknown, totals: { text: number }) {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["type", "text", "styles"]) ||
    value.type !== "text" ||
    typeof value.text !== "string" ||
    value.text.length > 100_000 ||
    !validateStyles(value.styles)
  )
    return false;
  totals.text += value.text.length;
  return totals.text <= 1_000_000;
}

function validateInline(value: unknown, totals: { text: number }): boolean {
  if (!isObject(value)) return false;
  if (value.type === "text") return validateStyledText(value, totals);
  if (
    value.type !== "link" ||
    !hasOnlyKeys(value, ["type", "href", "content"]) ||
    !isSafeLink(value.href) ||
    !Array.isArray(value.content) ||
    value.content.length > 10_000
  )
    return false;
  return value.content.every((item) => validateStyledText(item, totals));
}

/**
 * An image, video, or file block. The url is either one of this app's own
 * uploads or a link the editor's embed tab accepted, so it is held to the same
 * protocols as a link, and the preview width has to be a real pixel count.
 */
function validateFileProps(type: string, value: Record<string, unknown>) {
  const keys =
    type === "file"
      ? ["backgroundColor", "name", "url", "caption"]
      : [
          "backgroundColor",
          "textAlignment",
          "name",
          "url",
          "caption",
          "showPreview",
          "previewWidth",
        ];
  if (!hasOnlyKeys(value, keys)) return false;
  if (typeof value.backgroundColor !== "string" || value.backgroundColor.length > 64)
    return false;
  if (
    "textAlignment" in value &&
    (typeof value.textAlignment !== "string" || !alignments.has(value.textAlignment))
  )
    return false;
  for (const text of [value.name, value.caption])
    if (typeof text !== "string" || text.length > 2_048) return false;
  if (typeof value.url !== "string" || (value.url !== "" && !isSafeLink(value.url)))
    return false;
  if ("showPreview" in value && typeof value.showPreview !== "boolean") return false;
  if (
    "previewWidth" in value &&
    value.previewWidth !== undefined &&
    value.previewWidth !== null &&
    (typeof value.previewWidth !== "number" ||
      !Number.isFinite(value.previewWidth) ||
      value.previewWidth <= 0 ||
      value.previewWidth > 10_000)
  )
    return false;
  return true;
}

function validateEmbedProps(type: string, value: Record<string, unknown>) {
  if (!hasOnlyKeys(value, ["url", "textAlignment"])) return false;
  const url = value.url;
  if (typeof url !== "string") return false;
  // A media embed answers for its own URLs; bookmark takes what is left, so
  // any URL a card may link to passes.
  const matcher = embedMatchers.find((entry) => entry.type === type);
  if (matcher) {
    if (matcher.match(url) === null) return false;
  } else if (linkPreviewUrl(url) === null) return false;
  if (
    "textAlignment" in value &&
    (typeof value.textAlignment !== "string" || !alignments.has(value.textAlignment))
  )
    return false;
  return true;
}

function validateProps(type: string, value: unknown) {
  if (!isObject(value)) return false;
  const base = ["backgroundColor", "textColor", "textAlignment"];
  if (embedBlockTypes.has(type)) return validateEmbedProps(type, value);
  if (fileBlockTypes.has(type)) return validateFileProps(type, value);
  const keys =
    type === "heading"
      ? [...base, "level", "isToggleable"]
      : type === "checkListItem"
        ? [...base, "checked"]
        : type === "numberedListItem"
          ? [...base, "start"]
          : type === "codeBlock"
            ? ["language"]
            : type === "table"
              ? ["textColor"]
              : type === "quote"
                ? ["backgroundColor", "textColor"]
                : base;
  if (!hasOnlyKeys(value, keys)) return false;
  for (const color of ["backgroundColor", "textColor"])
    if (color in value && (typeof value[color] !== "string" || value[color].length > 64))
      return false;
  if (
    "textAlignment" in value &&
    (typeof value.textAlignment !== "string" || !alignments.has(value.textAlignment))
  )
    return false;
  if (
    type === "heading" &&
    (!Number.isInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 6)
  )
    return false;
  if ("isToggleable" in value && typeof value.isToggleable !== "boolean") return false;
  if (type === "checkListItem" && typeof value.checked !== "boolean") return false;
  if (
    "start" in value &&
    value.start !== undefined &&
    (!Number.isInteger(value.start) || Number(value.start) < 1 || Number(value.start) > 1_000_000)
  )
    return false;
  if (type === "codeBlock" && (typeof value.language !== "string" || value.language.length > 64))
    return false;
  return true;
}

function validateTable(value: unknown, totals: { text: number }) {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["type", "columnWidths", "headerRows", "headerCols", "rows"]) ||
    value.type !== "tableContent" ||
    !Array.isArray(value.columnWidths) ||
    value.columnWidths.length > 100 ||
    !value.columnWidths.every(
      (width) =>
        width === undefined ||
        width === null ||
        (typeof width === "number" && Number.isFinite(width) && width > 0),
    ) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 1_000
  )
    return false;
  for (const header of [value.headerRows, value.headerCols])
    if (header !== undefined && (!Number.isInteger(header) || Number(header) < 0 || Number(header) > 100))
      return false;
  return value.rows.every((row) => {
    if (!isObject(row) || !hasOnlyKeys(row, ["cells"]) || !Array.isArray(row.cells)) return false;
    return row.cells.every((cell) => {
      if (Array.isArray(cell)) return cell.every((item) => validateInline(item, totals));
      if (
        !isObject(cell) ||
        !hasOnlyKeys(cell, ["type", "props", "content"]) ||
        cell.type !== "tableCell" ||
        !isObject(cell.props) ||
        !hasOnlyKeys(cell.props, ["backgroundColor", "textColor", "textAlignment", "colspan", "rowspan"]) ||
        !Array.isArray(cell.content)
      )
        return false;
      for (const span of [cell.props.colspan, cell.props.rowspan])
        if (span !== undefined && (!Number.isInteger(span) || Number(span) < 1 || Number(span) > 100))
          return false;
      for (const color of [cell.props.backgroundColor, cell.props.textColor])
        if (typeof color !== "string" || color.length > 64) return false;
      if (
        typeof cell.props.textAlignment !== "string" ||
        !alignments.has(cell.props.textAlignment)
      )
        return false;
      return cell.content.every((item) => validateInline(item, totals));
    });
  });
}

export function validateContentDocument(value: unknown): value is ContentBlock[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) return false;
  let blocks = 0;
  const totals = { text: 0 };
  const visit = (items: unknown[], depth: number): boolean => {
    if (depth > 16) return false;
    return items.every((item) => {
      blocks += 1;
      if (
        blocks > 10_000 ||
        !isObject(item) ||
        !hasOnlyKeys(item, ["id", "type", "props", "content", "children"]) ||
        typeof item.id !== "string" ||
        item.id.length < 1 ||
        item.id.length > 256 ||
        typeof item.type !== "string" ||
        !supportedBlockTypes.has(item.type) ||
        !validateProps(item.type, item.props) ||
        !Array.isArray(item.children) ||
        !visit(item.children, depth + 1)
      )
        return false;
      // A file or embed block carries its target in props and has no inline content.
      if (fileBlockTypes.has(item.type) || embedBlockTypes.has(item.type))
        return item.content === undefined || (Array.isArray(item.content) && !item.content.length);
      if (item.type === "table") return validateTable(item.content, totals);
      if (item.type === "codeBlock") {
        return (
          Array.isArray(item.content) &&
          item.content.every((entry) =>
            validateStyledText(entry, totals) &&
            isObject(entry) &&
            isObject(entry.styles) &&
            Object.keys(entry.styles).length === 0,
          )
        );
      }
      return Array.isArray(item.content) && item.content.every((entry) => validateInline(entry, totals));
    });
  };
  return visit(value, 1) && JSON.stringify(value).length <= 2_000_000;
}

export const savePageSchema = z.object({
  id: idSchema,
  title: pageTitleSchema,
  revision: z.number().int().nonnegative(),
  document: z.custom<ContentBlock[]>(validateContentDocument, {
    message: "The page contains unsupported or invalid content.",
  }),
});

export type SavePageInput = z.infer<typeof savePageSchema>;


/** A board column, or a section of the page list. */
export type ContentGroupBucket = {
  /** The property id this bucket collects, or null for the "none" bucket. */
  id: string | null;
  label: string;
  color: PropertyColor;
  pages: ContentPage[];
};

function matchesEvery(selected: string[] | undefined, has: (id: string) => boolean) {
  if (!selected?.length) return true;
  return selected.some(has);
}

/** True when anything narrows the view, so the UI can offer to clear it. */
export function hasFilters(search: {
  q?: string;
  tree?: string;
  status?: string[];
  type?: string[];
  tag?: string[];
}) {
  return Boolean(
    search.q?.trim() ||
      search.tree ||
      search.status?.length ||
      search.type?.length ||
      search.tag?.length,
  );
}

/** The selected page and every page reachable below it. */
export function pageTreeIds(pages: ContentPage[], rootId: string) {
  if (!pages.some((page) => page.id === rootId)) return new Set<string>();
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const group = children.get(page.parentId) ?? [];
    group.push(page.id);
    children.set(page.parentId, group);
  }
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return ids;
}

export function filterPages(
  pages: ContentPage[],
  search: {
    q?: string;
    tree?: string;
    status?: string[];
    type?: string[];
    tag?: string[];
  },
) {
  const q = search.q?.trim().toLowerCase() ?? "";
  const treeIds = search.tree ? pageTreeIds(pages, search.tree) : null;
  return pages.filter(
    (page) =>
      (!treeIds || treeIds.has(page.id)) &&
      (!q || displayPageTitle(page.title).toLowerCase().includes(q)) &&
      matchesEvery(search.status, (id) => page.statusId === id) &&
      matchesEvery(search.type, (id) => page.typeIds.includes(id)) &&
      matchesEvery(search.tag, (id) => page.tagIds.includes(id)),
  );
}

/**
 * Narrows server search results without repeating its full-text search in the
 * browser. The complete hierarchy supplies ancestors that the search result
 * may omit.
 */
export function filterPageSearchResults(
  matches: ContentPage[],
  hierarchy: ContentPage[],
  search: ContentSearch,
) {
  const treeIds = search.tree ? pageTreeIds(hierarchy, search.tree) : null;
  return filterPages(matches, {
    status: search.status,
    type: search.type,
    tag: search.tag,
  }).filter((page) => !treeIds || treeIds.has(page.id));
}

/**
 * Pinned pages sit above their unpinned siblings. Order among each group is
 * the stored display order, then title.
 */
export function compareIndexPages(a: ContentPage, b: ContentPage) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.order - b.order || a.title.localeCompare(b.title);
}

export function sortPages(pages: ContentPage[], sort: ContentSort = "manual") {
  const byTitle = (a: ContentPage, b: ContentPage) =>
    a.title.localeCompare(b.title);
  const compare: Record<ContentSort, (a: ContentPage, b: ContentPage) => number> = {
    manual: (a, b) => a.position - b.position || byTitle(a, b),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byTitle(a, b),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt) || byTitle(a, b),
    title: byTitle,
  };
  return [...pages].sort(compare[sort]);
}

/**
 * Splits pages into the buckets of one property list, keeping that list's own
 * order. Pages without the property fall into a trailing "none" bucket, which
 * is dropped only when it is empty.
 */
export function groupPages(
  pages: ContentPage[],
  group: ContentGroup,
  properties: ContentProperties,
  options: { hideEmpty?: boolean } = {},
): ContentGroupBucket[] {
  const list =
    group === "status"
      ? properties.statuses
      : group === "type"
        ? properties.types
        : properties.tags;
  const belongs = (page: ContentPage, id: string) =>
    group === "status"
      ? page.statusId === id
      : group === "type"
        ? page.typeIds.includes(id)
        : page.tagIds.includes(id);
  const buckets: ContentGroupBucket[] = list.map((property) => ({
    id: property.id,
    label: property.name,
    color: property.color,
    pages: pages.filter((page) => belongs(page, property.id)),
  }));
  const orphans = pages.filter(
    (page) => !list.some((property) => belongs(page, property.id)),
  );
  // A subpage carries no status, so the status grouping needs this column too
  // or the board would simply lose it.
  if (orphans.length)
    buckets.push({
      id: null,
      label: group === "status" ? "No status" : group === "type" ? "No type" : "Untagged",
      color: "slate",
      pages: orphans,
    });
  return options.hideEmpty
    ? buckets.filter((bucket) => bucket.pages.length > 0)
    : buckets;
}

/** Compact "3h ago" for card timestamps. Exact dates live in the editor. */
export function relativeTime(iso: string, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** What the homepage shows of Content: the pipeline, and what is moving. */
export type ContentSummary = {
  total: number;
  counts: { id: string; name: string; color: PropertyColor; count: number }[];
  recent: {
    id: string;
    title: string;
    updatedAt: string;
    status: string | null;
    statusColor: PropertyColor | null;
    type: string | null;
  }[];
};

/**
 * The pipeline as counts per status, in the order Settings gives them, plus
 * the pages touched most recently. Pages without a status are counted under
 * their own bucket rather than being dropped, because a count that does not
 * add up to the total is worse than an extra column.
 */
export function contentSummary(
  pages: ContentPage[],
  properties: ContentProperties,
  limit = 4,
): ContentSummary {
  const statuses = new Map(properties.statuses.map((s) => [s.id, s]));
  const types = new Map(properties.types.map((t) => [t.id, t]));
  const counts = properties.statuses.map((status) => ({
    id: status.id,
    name: status.name,
    color: status.color,
    count: pages.filter((page) => page.statusId === status.id).length,
  }));
  const unassigned = pages.filter(
    (page) => !page.statusId || !statuses.has(page.statusId),
  ).length;
  if (unassigned)
    counts.push({
      id: "none",
      name: "No status",
      color: "slate",
      count: unassigned,
    });
  const recent = [...pages]
    .sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((page) => {
      const status = page.statusId ? statuses.get(page.statusId) : undefined;
      const names = page.typeIds
        .map((id) => types.get(id)?.name)
        .filter((name) => name !== undefined);
      return {
        id: page.id,
        title: displayPageTitle(page.title),
        updatedAt: page.updatedAt,
        status: status?.name ?? null,
        statusColor: status?.color ?? null,
        type: names.length ? names.join(", ") : null,
      };
    });
  return { total: pages.length, counts, recent };
}

/**
 * The three glyphs a page can show. Mixed types sit side by side, they do not
 * collapse to a fourth "combination" mark.
 */
export const PAGE_TYPE_ICONS = ["youtube", "stream", "note"] as const;
export type PageTypeIconKind = (typeof PAGE_TYPE_ICONS)[number];

/** A glyph in the colour of the type it stands for. */
export type PageTypeIcon = { kind: PageTypeIconKind; color: PropertyColor };

const TYPE_NAME_ICONS: Record<string, PageTypeIconKind> = {
  stream: "stream",
  "youtube video": "youtube",
  "blog post": "note",
  "architecture article": "note",
};

function typeNameKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function kindForType(type: Property | undefined): PageTypeIconKind {
  if (!type) return "note";
  return TYPE_NAME_ICONS[typeNameKey(type.name)] ?? "note";
}

/**
 * Icons for a page's current type selection, in a stable order, with
 * duplicates removed so two article types still draw as one note. Each glyph
 * takes the colour of the first selected type that maps onto it; a page with
 * no type gets a neutral note.
 */
export function pageTypeIcons(typeIds: string[], types: Property[]): PageTypeIcon[] {
  if (typeIds.length === 0) return [{ kind: "note", color: "slate" }];
  const colors = new Map<PageTypeIconKind, PropertyColor>();
  for (const id of typeIds) {
    const type = types.find((candidate) => candidate.id === id);
    const kind = kindForType(type);
    if (!colors.has(kind)) colors.set(kind, type?.color ?? "slate");
  }
  return PAGE_TYPE_ICONS.flatMap((kind) => {
    const color = colors.get(kind);
    return color ? [{ kind, color }] : [];
  });
}

/**
 * The glyphs a subpage can show: one per default media type, plus a neutral
 * file for a type someone added or renamed past recognition. The list is data,
 * not a fixed set of types — a new entry in Settings draws as a file until a
 * glyph is claimed for its name here.
 */
export const SUBPAGE_TYPE_ICONS = [
  "website",
  "github",
  "tweet",
  "image",
  "video",
  "file",
] as const;
export type SubpageTypeIconKind = (typeof SUBPAGE_TYPE_ICONS)[number];

const SUBPAGE_TYPE_NAME_ICONS: Record<string, SubpageTypeIconKind> = {
  website: "website",
  github: "github",
  tweet: "tweet",
  image: "image",
  video: "video",
};

/** A subpage glyph in the colour of the type it stands for. */
export type SubpageTypeIcon = { kind: SubpageTypeIconKind; color: PropertyColor };

function subpageKindForType(type: Property): SubpageTypeIconKind {
  // Own keys only: a type named "constructor" or "toString" would otherwise
  // find something on Object.prototype and draw nothing at all.
  const name = typeNameKey(type.name);
  return Object.hasOwn(SUBPAGE_TYPE_NAME_ICONS, name)
    ? SUBPAGE_TYPE_NAME_ICONS[name]!
    : "file";
}

/**
 * Glyphs for a subpage's type selection, the same way `pageTypeIcons` draws a
 * page's: in a stable order, one per glyph, each in the colour of the first
 * selected type that maps onto it. An unknown or renamed type keeps its own
 * colour behind the neutral file. A subpage with no type, or only types that
 * are gone, gets one neutral file.
 */
export function subpageTypeIcons(
  subpageTypeIds: string[],
  subpageTypes: Property[],
): SubpageTypeIcon[] {
  const colors = new Map<SubpageTypeIconKind, PropertyColor>();
  for (const id of subpageTypeIds) {
    const type = subpageTypes.find((candidate) => candidate.id === id);
    if (!type) continue;
    const kind = subpageKindForType(type);
    if (!colors.has(kind)) colors.set(kind, type.color);
  }
  if (colors.size === 0) return [{ kind: "file", color: "slate" }];
  return SUBPAGE_TYPE_ICONS.flatMap((kind) => {
    const color = colors.get(kind);
    return color ? [{ kind, color }] : [];
  });
}

/** True when the page hangs under another one, so it is typed as media. */
export function isSubpage(page: { parentId: string | null }) {
  return page.parentId !== null;
}

/**
 * True when a board drag may land the card in that column. `from` and `to` are
 * the columns' property ids, or null for the trailing column that collects the
 * pages with none.
 *
 * A subpage is typed from the subpage list and holds no status, so crossing
 * into a page type's column or a status column would give it a property its
 * own panel never offers and its card never shows. Emptying it is always
 * allowed, and so is reordering a subpage inside the column it is already in.
 *
 * The "No status" column is the other way round: every page has a status and
 * the board has no way to take it away, so a page dropped there would spring
 * back to the column it came from having quietly reordered that one. Only
 * subpages belong in it.
 */
export function canDropOnColumn(
  page: { parentId: string | null },
  group: ContentGroup,
  from: string | null,
  to: string | null,
) {
  if (group === "tag") return true;
  if (group === "status" && to === null) return isSubpage(page);
  if (!isSubpage(page)) return true;
  return to === null || from === to;
}

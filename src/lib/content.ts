import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ContentBlock = { [key: string]: JsonValue };

/** The three property lists a page is described by. */
export const PROPERTY_KINDS = ["status", "type", "tag"] as const;
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
  typeId: string | null;
  tagIds: string[];
  /** Manual order within a board column. */
  position: number;
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

/** Label for lists, crumbs, and cards when the stored title is empty. */
export function displayPageTitle(title: string) {
  return title.trim() || DEFAULT_PAGE_TITLE;
}

export const propertyNameSchema = z.string().trim().min(1).max(60);
export const propertyKindSchema = z.enum(PROPERTY_KINDS);
export const propertyColorSchema = z.enum(PROPERTY_COLORS);

export const SORTS = ["manual", "updated", "created", "title"] as const;
export type ContentSort = (typeof SORTS)[number];
export const GROUPS = PROPERTY_KINDS;
export type ContentGroup = PropertyKind;

const idListSchema = z.array(idSchema).max(60).optional().catch(undefined);

/**
 * Every filter, sort, and grouping choice lives here so a board is a URL. All
 * of it is optional: an absent value is the default, which keeps links short.
 */
export const contentSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  page: idSchema.optional().catch(undefined),
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
  typeId: idSchema.nullable().optional().default(null),
  tagIds: z.array(idSchema).max(60).optional().default([]),
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
  statusId: idSchema.optional(),
  typeId: idSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(60).optional(),
});

/**
 * One drag. The destination column is described by whichever grouping the board
 * is showing, and `orderedIds` is that column's final order, so the manual
 * sequence is rewritten from what the user actually sees.
 */
export const movePageCardSchema = z.object({
  id: idSchema,
  statusId: idSchema.optional(),
  typeId: idSchema.nullable().optional(),
  addTagId: idSchema.optional(),
  removeTagId: idSchema.optional(),
  /** The page's whole tag list, for a drop that is not one tag's worth. */
  tagIds: z.array(idSchema).max(60).optional(),
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
]);
/** Blocks that hold a file rather than text: no inline content, a url instead. */
const fileBlockTypes = new Set(["image", "video", "file"]);
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

function validateProps(type: string, value: unknown) {
  if (!isObject(value)) return false;
  const base = ["backgroundColor", "textColor", "textAlignment"];
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
      // A file block carries its file in props and has no inline content.
      if (fileBlockTypes.has(item.type))
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
  status?: string[];
  type?: string[];
  tag?: string[];
}) {
  return Boolean(
    search.q?.trim() ||
      search.status?.length ||
      search.type?.length ||
      search.tag?.length,
  );
}

export function filterPages(
  pages: ContentPage[],
  search: { q?: string; status?: string[]; type?: string[]; tag?: string[] },
) {
  const q = search.q?.trim().toLowerCase() ?? "";
  return pages.filter(
    (page) =>
      (!q || displayPageTitle(page.title).toLowerCase().includes(q)) &&
      matchesEvery(search.status, (id) => page.statusId === id) &&
      matchesEvery(search.type, (id) => page.typeId === id) &&
      matchesEvery(search.tag, (id) => page.tagIds.includes(id)),
  );
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
        ? page.typeId === id
        : page.tagIds.includes(id);
  const buckets: ContentGroupBucket[] = list.map((property) => ({
    id: property.id,
    label: property.name,
    color: property.color,
    pages: pages.filter((page) => belongs(page, property.id)),
  }));
  if (group !== "status") {
    const orphans = pages.filter(
      (page) => !list.some((property) => belongs(page, property.id)),
    );
    if (orphans.length)
      buckets.push({
        id: null,
        label: group === "type" ? "No type" : "Untagged",
        color: "slate",
        pages: orphans,
      });
  }
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
      const type = page.typeId ? types.get(page.typeId) : undefined;
      return {
        id: page.id,
        title: displayPageTitle(page.title),
        updatedAt: page.updatedAt,
        status: status?.name ?? null,
        statusColor: status?.color ?? null,
        type: type?.name ?? null,
      };
    });
  return { total: pages.length, counts, recent };
}

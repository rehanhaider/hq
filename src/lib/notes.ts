import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type NoteBlock = { [key: string]: JsonValue };

export type NotePage = {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  preview: string;
};

export type NoteDetail = NotePage & {
  document: NoteBlock[];
};

const idSchema = z.string().uuid();
export const noteTitleSchema = z.string().trim().min(1).max(200);

export const notesSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  page: idSchema.optional().catch(undefined),
});

export const listNotesSchema = z.object({
  q: z.string().trim().max(200).optional(),
  trashed: z.boolean().optional().default(false),
});

export const createNoteSchema = z.object({
  title: noteTitleSchema.optional().default("Untitled"),
  parentId: idSchema.nullable().optional().default(null),
});

export const noteIdSchema = z.object({ id: idSchema });

export const changeNoteStateSchema = z.object({
  id: idSchema,
  revision: z.number().int().nonnegative(),
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
]);
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

function validateProps(type: string, value: unknown) {
  if (!isObject(value)) return false;
  const base = ["backgroundColor", "textColor", "textAlignment"];
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

export function validateNoteDocument(value: unknown): value is NoteBlock[] {
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

export const saveNoteSchema = z.object({
  id: idSchema,
  title: noteTitleSchema,
  revision: z.number().int().nonnegative(),
  document: z.custom<NoteBlock[]>(validateNoteDocument, {
    message: "The note contains unsupported or invalid content.",
  }),
});

export type SaveNoteInput = z.infer<typeof saveNoteSchema>;

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PROPERTY_COLORS,
  type ContentBlock,
  type ContentPage,
  type ContentProperties,
  type PageDetail,
  type Property,
  type PropertyColor,
  type PropertyKind,
  type SavePageInput,
  type StoredUpload,
} from "../lib/content";
import { uploadIdsInDocument } from "../lib/uploads";

const emptyDocument = (): ContentBlock[] => [
  {
    id: randomUUID(),
    type: "paragraph",
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
    },
    content: [],
    children: [],
  },
];

/** The property list each kind is stored in. The values are literals, never input. */
const PROPERTY_TABLES: Record<PropertyKind, string> = {
  status: "statuses",
  type: "types",
  tag: "tags",
};

/**
 * What a fresh database starts with: the pipeline a stream takes from an idea to
 * a published video or article, and the four things this module produces.
 */
const SEED_STATUSES: [string, PropertyColor][] = [
  ["Idea", "slate"],
  ["Planned", "blue"],
  ["Drafting", "violet"],
  ["Recorded", "teal"],
  ["Editing", "amber"],
  ["Scheduled", "orange"],
  ["Published", "green"],
  ["Archived", "slate"],
];
const SEED_TYPES: [string, PropertyColor][] = [
  ["Stream", "pink"],
  ["YouTube video", "red"],
  ["Blog post", "blue"],
  ["Architecture article", "violet"],
];

type PageRow = {
  id: string;
  title: string;
  document: string;
  search_text: string;
  parent_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  deletion_group: string | null;
  status_id: string | null;
  position: number;
  type_ids: string | null;
  tag_ids: string | null;
};

type PageListRow = Omit<PageRow, "document" | "search_text" | "deletion_group"> & {
  preview: string;
};

type PropertyRow = { id: string; name: string; color: string; position: number };

type UploadRow = {
  id: string;
  page_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
};

function uploadFromRow(row: UploadRow): StoredUpload {
  return {
    id: row.id,
    pageId: row.page_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    createdAt: row.created_at,
  };
}

function normalizeSearch(value: string) {
  return value.normalize("NFC").toLowerCase();
}

function textFromDocument(document: ContentBlock[]) {
  const parts: string[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      else Object.values(item).forEach(collect);
    }
  };
  collect(document);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function tagIdsFrom(value: string | null) {
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}

function propertyFromRow(row: PropertyRow): Property {
  return {
    id: row.id,
    name: row.name,
    color: (PROPERTY_COLORS as readonly string[]).includes(row.color)
      ? (row.color as PropertyColor)
      : "slate",
    position: row.position,
  };
}

function fromRow(row: PageRow): PageDetail {
  const document = JSON.parse(row.document) as ContentBlock[];
  return {
    ...pageFromRow({ ...row, preview: textFromDocument(document).slice(0, 180) }),
    document,
  };
}

function pageFromRow(row: Omit<PageListRow, "preview"> & { preview: string }): ContentPage {
  return {
    id: row.id,
    title: row.title,
    parentId: row.parent_id,
    order: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    preview: row.preview,
    statusId: row.status_id,
    typeIds: tagIdsFrom(row.type_ids),
    tagIds: tagIdsFrom(row.tag_ids),
    position: row.position,
  };
}

const LIST_COLUMNS = `pages.id, pages.title, substr(pages.search_text, 1, 180) AS preview,
        pages.parent_id, pages.display_order, pages.created_at, pages.updated_at,
        pages.deleted_at, pages.revision, pages.status_id, pages.position,
        (SELECT group_concat(type_id ORDER BY rowid) FROM page_types WHERE page_id = pages.id) AS type_ids,
        (SELECT group_concat(tag_id) FROM page_tags WHERE page_id = pages.id) AS tag_ids`;

export class ContentStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.function(
      "normalize_text",
      { deterministic: true },
      (value) => (typeof value === "string" ? normalizeSearch(value) : ""),
    );
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
    `);
    this.migrate();
  }

  /**
   * Additive and idempotent. Notes became Content, so a database written by the
   * old module is carried forward in place: the table is renamed, the property
   * columns are added, and every page that predates them is given the first
   * status so it appears on the board.
   */
  private migrate() {
    const hasTable = (name: string) =>
      Boolean(
        this.db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name),
      );
    if (hasTable("notes") && !hasTable("pages")) {
      this.db.exec(`
        DROP INDEX IF EXISTS notes_parent_order;
        DROP INDEX IF EXISTS notes_deleted_at;
        ALTER TABLE notes RENAME TO pages;
      `);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        document TEXT NOT NULL,
        search_text TEXT NOT NULL,
        parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
        display_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        deletion_group TEXT
      );
      CREATE INDEX IF NOT EXISTS pages_parent_order ON pages(parent_id, display_order);
      CREATE INDEX IF NOT EXISTS pages_deleted_at ON pages(deleted_at);
      CREATE TABLE IF NOT EXISTS statuses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS page_tags (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS page_tags_tag ON page_tags(tag_id);
      CREATE TABLE IF NOT EXISTS page_types (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        type_id TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, type_id)
      );
      CREATE INDEX IF NOT EXISTS page_types_type ON page_types(type_id);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT NOT NULL,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, page_id)
      );
      CREATE INDEX IF NOT EXISTS uploads_page ON uploads(page_id);
    `);

    const columns = new Set(
      (
        this.db.prepare("SELECT name FROM pragma_table_info('pages')").all() as unknown as {
          name: string;
        }[]
      ).map((column) => column.name),
    );
    // A required foreign key cannot be added to a populated table, so the column
    // arrives nullable and the backfill below fills it. Every write path since
    // then sets a status, and `list` never invents one.
    if (!columns.has("status_id"))
      this.db.exec("ALTER TABLE pages ADD COLUMN status_id TEXT REFERENCES statuses(id)");
    // Types used to be one column per page. They are a link table now, like
    // tags, so an existing column is carried over once and then dropped.
    if (columns.has("type_id")) {
      this.db.exec(`
        INSERT OR IGNORE INTO page_types (page_id, type_id)
        SELECT id, type_id FROM pages WHERE type_id IS NOT NULL
      `);
      try {
        this.db.exec("ALTER TABLE pages DROP COLUMN type_id");
      } catch {
        // Older SQLite cannot drop a column. The column is then simply
        // ignored: every read and write below uses page_types.
      }
    }
    if (!columns.has("position")) {
      this.db.exec("ALTER TABLE pages ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      // Oldest first, so a board that has never been reordered still reads in
      // the order the pages were written rather than arbitrarily.
      this.db.exec(`
        UPDATE pages SET position = ordered.rank
        FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rank FROM pages) AS ordered
        WHERE pages.id = ordered.id
      `);
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS pages_status_position ON pages(status_id, position)",
    );

    const seeded = this.db.prepare("SELECT value FROM meta WHERE key = 'properties_seeded'").get();
    if (!seeded) {
      this.transaction(() => {
        for (const [kind, rows] of [
          ["status", SEED_STATUSES],
          ["type", SEED_TYPES],
        ] as const) {
          const table = PROPERTY_TABLES[kind];
          const insert = this.db.prepare(
            `INSERT INTO ${table} (id, name, color, position) VALUES (?, ?, ?, ?)`,
          );
          rows.forEach(([name, color], index) => insert.run(randomUUID(), name, color, index));
        }
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES ('properties_seeded', ?)")
          .run(new Date().toISOString());
      });
    }

    const first = this.firstStatusId();
    if (first)
      this.db.prepare("UPDATE pages SET status_id = ? WHERE status_id IS NULL").run(first);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private firstStatusId(): string | null {
    const row = this.db
      .prepare("SELECT id FROM statuses ORDER BY position, name LIMIT 1")
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  private propertyExists(kind: PropertyKind, id: string) {
    return Boolean(
      this.db.prepare(`SELECT 1 FROM ${PROPERTY_TABLES[kind]} WHERE id = ?`).get(id),
    );
  }

  /**
   * Every property a write refers to, checked before any of it is applied. A
   * transaction body that returns a failure still reaches COMMIT, so rejecting
   * halfway through — a tag removed and its replacement then found missing —
   * would report a failed move and keep the damage.
   */
  private unknownProperty(input: {
    statusId?: string;
    addTypeId?: string;
    addTagId?: string;
  }) {
    if (input.statusId !== undefined && !this.propertyExists("status", input.statusId))
      return "unknown-status" as const;
    if (input.addTypeId !== undefined && !this.propertyExists("type", input.addTypeId))
      return "unknown-type" as const;
    if (input.addTagId !== undefined && !this.propertyExists("tag", input.addTagId))
      return "unknown-tag" as const;
    return null;
  }

  /** Replaces a page's types. Types that no longer exist are dropped. */
  private setTypes(pageId: string, typeIds: string[]) {
    this.db.prepare("DELETE FROM page_types WHERE page_id = ?").run(pageId);
    const link = this.db.prepare(
      "INSERT OR IGNORE INTO page_types (page_id, type_id) VALUES (?, ?)",
    );
    for (const typeId of new Set(typeIds))
      if (this.propertyExists("type", typeId)) link.run(pageId, typeId);
  }

  /** Replaces a page's tags. Tags that no longer exist are dropped. */
  private setTags(pageId: string, tagIds: string[]) {
    this.db.prepare("DELETE FROM page_tags WHERE page_id = ?").run(pageId);
    const link = this.db.prepare(
      "INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)",
    );
    for (const tagId of new Set(tagIds))
      if (this.propertyExists("tag", tagId)) link.run(pageId, tagId);
  }

  properties(): ContentProperties {
    const read = (kind: PropertyKind) =>
      (
        this.db
          .prepare(`SELECT id, name, color, position FROM ${PROPERTY_TABLES[kind]} ORDER BY position, name`)
          .all() as unknown as PropertyRow[]
      ).map(propertyFromRow);
    return { statuses: read("status"), types: read("type"), tags: read("tag") };
  }

  list({ q, trashed = false }: { q?: string; trashed?: boolean } = {}): ContentPage[] {
    const search = normalizeSearch(q?.trim() ?? "");
    const rows = this.db
      .prepare(
        `SELECT ${LIST_COLUMNS}
         FROM pages
         WHERE deleted_at IS ${trashed ? "NOT NULL" : "NULL"}
           AND (? = '' OR instr(normalize_text(title || ' ' || search_text), ?) > 0)
         ORDER BY display_order, created_at, id`,
      )
      .all(search, search) as unknown as PageListRow[];
    return rows.map(pageFromRow);
  }

  get(id: string): PageDetail | null {
    const page = this.getAny(id);
    return page?.deletedAt ? null : page;
  }

  private getAny(id: string): PageDetail | null {
    const row = this.db
      .prepare(
        `SELECT pages.*,
          (SELECT group_concat(type_id ORDER BY rowid) FROM page_types WHERE page_id = pages.id) AS type_ids,
          (SELECT group_concat(tag_id) FROM page_tags WHERE page_id = pages.id) AS tag_ids
         FROM pages WHERE id = ?`,
      )
      .get(id) as PageRow | undefined;
    return row ? fromRow(row) : null;
  }

  create(
    title = "",
    parentId: string | null = null,
    document = emptyDocument(),
    statusId: string | null = null,
    typeIds: string[] = [],
    tagIds: string[] = [],
  ): PageDetail {
    return this.transaction(() =>
      this.insert(title, parentId, document, statusId, typeIds, tagIds),
    );
  }

  private insert(
    title: string,
    parentId: string | null,
    document: ContentBlock[],
    statusId: string | null,
    typeIds: string[],
    tagIds: string[],
  ): PageDetail {
    let parent: PageDetail | null = null;
    if (parentId) {
      parent = this.get(parentId);
      if (!parent || parent.deletedAt) throw new Error("The parent page is not available.");
    }
    const status =
      statusId && this.propertyExists("status", statusId) ? statusId : this.firstStatusId();
    // A subpage is usually more of whatever its parent is, so it starts there.
    const requestedTypes = typeIds.length ? typeIds : (parent?.typeIds ?? []);
    const id = randomUUID();
    const now = new Date().toISOString();
    const order = Number(
      (
        this.db
          .prepare("SELECT coalesce(max(display_order), -1) + 1 AS next_order FROM pages WHERE parent_id IS ?")
          .get(parentId) as { next_order: number }
      ).next_order,
    );
    const position = Number(
      (
        this.db.prepare("SELECT coalesce(max(position), 0) + 1 AS next FROM pages").get() as {
          next: number;
        }
      ).next,
    );
    this.db
      .prepare(
        `INSERT INTO pages
         (id, title, document, search_text, parent_id, display_order, created_at, updated_at,
          deleted_at, revision, deletion_group, status_id, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`,
      )
      .run(
        id,
        title,
        JSON.stringify(document),
        textFromDocument(document),
        parentId,
        order,
        now,
        now,
        status,
        position,
      );
    const validTypes = [...new Set(requestedTypes)].filter((typeId) =>
      this.propertyExists("type", typeId),
    );
    if (validTypes.length) this.setTypes(id, validTypes);
    if (tagIds.length) this.setTags(id, tagIds);
    this.adoptUploads(id, document);
    return this.get(id)!;
  }

  save(input: SavePageInput) {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const result = this.db
        .prepare(
          `UPDATE pages SET title = ?, document = ?, search_text = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        )
        .run(
          input.title,
          JSON.stringify(input.document),
          textFromDocument(input.document),
          now,
          input.id,
          input.revision,
        );
      if (result.changes === 0) {
        const current = this.getAny(input.id);
        if (!current) return { ok: false as const, code: "missing" as const, current };
        return current.deletedAt
          ? { ok: false as const, code: "trashed" as const, current }
          : { ok: false as const, code: "stale" as const, current };
      }
      this.adoptUploads(input.id, input.document);
      return { ok: true as const, page: this.get(input.id)! };
    });
  }

  /**
   * Properties only: no document, no revision bump. An editor left open on this
   * page keeps saving against the revision it already holds.
   */
  setProperties(input: {
    id: string;
    statusId?: string;
    typeIds?: string[];
    tagIds?: string[];
  }) {
    return this.transaction(() => {
      const page = this.get(input.id);
      if (!page) return { ok: false as const, code: "missing" as const };
      const unknown = this.unknownProperty(input);
      if (unknown) return { ok: false as const, code: unknown };
      if (input.statusId !== undefined)
        this.db.prepare("UPDATE pages SET status_id = ? WHERE id = ?").run(input.statusId, input.id);
      if (input.typeIds) this.setTypes(input.id, input.typeIds);
      if (input.tagIds) this.setTags(input.id, input.tagIds);
      this.db
        .prepare("UPDATE pages SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), input.id);
      return { ok: true as const, page: this.get(input.id)! };
    });
  }

  /**
   * One drag on the board: the grouping change and the new manual order of the
   * destination column, applied together.
   */
  moveCard(input: {
    id: string;
    statusId?: string;
    addTypeId?: string;
    removeTypeId?: string;
    addTagId?: string;
    removeTagId?: string;
    /** The page's whole type list, for a drop that is not one type's worth. */
    typeIds?: string[];
    /** The page's whole tag list, for a drop that is not one tag's worth. */
    tagIds?: string[];
    orderedIds?: string[];
  }) {
    return this.transaction(() => {
      const page = this.get(input.id);
      if (!page) return { ok: false as const, code: "missing" as const };
      const unknown = this.unknownProperty(input);
      if (unknown) return { ok: false as const, code: unknown };
      if (input.statusId !== undefined)
        this.db.prepare("UPDATE pages SET status_id = ? WHERE id = ?").run(input.statusId, input.id);
      if (input.typeIds) this.setTypes(input.id, input.typeIds);
      else {
        if (input.removeTypeId)
          this.db
            .prepare("DELETE FROM page_types WHERE page_id = ? AND type_id = ?")
            .run(input.id, input.removeTypeId);
        if (input.addTypeId)
          this.db
            .prepare("INSERT OR IGNORE INTO page_types (page_id, type_id) VALUES (?, ?)")
            .run(input.id, input.addTypeId);
      }
      if (input.tagIds) this.setTags(input.id, input.tagIds);
      else {
        if (input.removeTagId)
          this.db
            .prepare("DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?")
            .run(input.id, input.removeTagId);
        if (input.addTagId)
          this.db
            .prepare("INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)")
            .run(input.id, input.addTagId);
      }
      this.reposition(input.orderedIds ?? []);
      this.db
        .prepare("UPDATE pages SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), input.id);
      return { ok: true as const, page: this.get(input.id)! };
    });
  }

  /**
   * Lays the given pages out in the given order by dealing out the positions
   * they already hold, rather than numbering them from zero. A column is only
   * ever part of the board — the other columns, and anything a filter is
   * hiding, keep their positions — so numbering from zero would collide with
   * them and scramble the manual order the moment the board is grouped or
   * filtered differently. Dealing out existing slots keeps every position
   * distinct and leaves the pages that were not dragged where they were.
   */
  private reposition(orderedIds: string[]) {
    if (orderedIds.length < 2) return;
    const rows = this.db
      .prepare(
        `SELECT id, position FROM pages
         WHERE deleted_at IS NULL AND id IN (${orderedIds.map(() => "?").join(", ")})`,
      )
      .all(...orderedIds) as unknown as { id: string; position: number }[];
    const held = new Map(rows.map((row) => [row.id, Number(row.position)]));
    const slots = [...held.values()].sort((a, b) => a - b);
    const place = this.db.prepare("UPDATE pages SET position = ? WHERE id = ?");
    orderedIds
      .filter((id, index) => held.has(id) && orderedIds.indexOf(id) === index)
      .forEach((id, index) => place.run(slots[index]!, id));
  }

  createProperty(kind: PropertyKind, name: string, color?: PropertyColor) {
    return this.transaction(() => {
      const table = PROPERTY_TABLES[kind];
      const existing = this.db
        .prepare(`SELECT id FROM ${table} WHERE lower(name) = lower(?)`)
        .get(name) as { id: string } | undefined;
      if (existing) return { ok: true as const, id: existing.id, created: false as const };
      const count = Number(
        (this.db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      );
      // After a deletion the positions have a gap, so the count is already
      // taken. A new entry belongs at the end of the list, past the highest.
      const position = Number(
        (
          this.db
            .prepare(`SELECT coalesce(max(position), -1) + 1 AS next FROM ${table}`)
            .get() as { next: number }
        ).next,
      );
      const id = randomUUID();
      this.db
        .prepare(`INSERT INTO ${table} (id, name, color, position) VALUES (?, ?, ?, ?)`)
        .run(id, name, color ?? PROPERTY_COLORS[count % PROPERTY_COLORS.length]!, position);
      return { ok: true as const, id, created: true as const };
    });
  }

  updateProperty(kind: PropertyKind, id: string, changes: { name?: string; color?: PropertyColor }) {
    return this.transaction(() => {
      if (!this.propertyExists(kind, id)) return { ok: false as const, code: "missing" as const };
      const table = PROPERTY_TABLES[kind];
      if (changes.name !== undefined) {
        // Creating reuses a name that already exists, so renaming must not be
        // able to produce the duplicate that creating refuses to: two columns
        // reading the same would split pages between them.
        const clash = this.db
          .prepare(`SELECT 1 FROM ${table} WHERE lower(name) = lower(?) AND id <> ?`)
          .get(changes.name, id);
        if (clash) return { ok: false as const, code: "duplicate" as const };
        this.db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(changes.name, id);
      }
      if (changes.color !== undefined)
        this.db.prepare(`UPDATE ${table} SET color = ? WHERE id = ?`).run(changes.color, id);
      return { ok: true as const };
    });
  }

  reorderProperties(kind: PropertyKind, ids: string[]) {
    return this.transaction(() => {
      const place = this.db.prepare(
        `UPDATE ${PROPERTY_TABLES[kind]} SET position = ? WHERE id = ?`,
      );
      ids.forEach((id, index) => place.run(index, id));
      return { ok: true as const };
    });
  }

  /**
   * Deleting a property never deletes a page. A status hands its pages to
   * another one, a type drops its links, and a tag drops its links.
   */
  deleteProperty(kind: PropertyKind, id: string, moveToId: string | null = null) {
    return this.transaction(() => {
      if (!this.propertyExists(kind, id)) return { ok: false as const, code: "missing" as const };
      if (kind === "status") {
        const total = Number(
          (this.db.prepare("SELECT count(*) AS total FROM statuses").get() as { total: number })
            .total,
        );
        if (total <= 1) return { ok: false as const, code: "last" as const };
        const pages = Number(
          (
            this.db
              .prepare("SELECT count(*) AS total FROM pages WHERE status_id = ?")
              .get(id) as { total: number }
          ).total,
        );
        if (pages > 0) {
          if (!moveToId || moveToId === id || !this.propertyExists("status", moveToId))
            return { ok: false as const, code: "pages" as const, pages };
          this.db
            .prepare("UPDATE pages SET status_id = ? WHERE status_id = ?")
            .run(moveToId, id);
        }
      }
      if (kind === "type")
        this.db.prepare("DELETE FROM page_types WHERE type_id = ?").run(id);
      if (kind === "tag") this.db.prepare("DELETE FROM page_tags WHERE tag_id = ?").run(id);
      this.db.prepare(`DELETE FROM ${PROPERTY_TABLES[kind]} WHERE id = ?`).run(id);
      return { ok: true as const };
    });
  }

  trash(id: string, revision: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(id);
      if (!current || current.deletedAt || current.revision !== revision) {
        this.db.exec("ROLLBACK");
        return { ok: false as const, code: "stale" as const, current };
      }
      const now = new Date().toISOString();
      const deletionGroup = randomUUID();
      this.db
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM pages WHERE id = ?
             UNION ALL SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
           )
           UPDATE pages SET deleted_at = ?, deletion_group = ?, updated_at = ?, revision = revision + 1
           WHERE id IN descendants AND deleted_at IS NULL`,
        )
        .run(id, now, deletionGroup, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true as const };
  }

  restore(id: string, revision: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getAny(id);
      if (!current || !current.deletedAt || current.revision !== revision) {
        this.db.exec("ROLLBACK");
        return { ok: false as const, code: "stale" as const, current };
      }
      const now = new Date().toISOString();
      const batch = (
        this.db.prepare("SELECT deletion_group FROM pages WHERE id = ?").get(id) as {
          deletion_group: string;
        }
      ).deletion_group;
      this.db
        .prepare(
          `WITH RECURSIVE ancestors(id) AS (
             SELECT id FROM pages WHERE id = ?
             UNION SELECT pages.parent_id FROM pages JOIN ancestors ON pages.id = ancestors.id WHERE pages.parent_id IS NOT NULL
           ), descendants(id) AS (
             SELECT id FROM pages WHERE id = ?
             UNION ALL SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
           )
           UPDATE pages SET deleted_at = NULL, deletion_group = NULL, updated_at = ?, revision = revision + 1
           WHERE deleted_at IS NOT NULL AND
             (id IN ancestors OR (id IN descendants AND deletion_group = ?))`,
        )
        .run(id, id, now, batch);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true as const };
  }

  /**
   * Links an uploaded file to the page it was inserted into. The id is the
   * file's content hash, so two pages using the same picture share one row each
   * and one file on disk.
   */
  recordUpload(input: {
    id: string;
    pageId: string;
    name: string;
    mime: string;
    size: number;
  }) {
    return this.transaction(() => this.linkUpload(input));
  }

  /**
   * A page that shows `/api/uploads/<id>` without an uploads row — a save-as-new
   * copy, or a pasted block — still uses that file. Erase only consults the
   * table, so the row has to exist before the original page can be deleted.
   */
  private adoptUploads(pageId: string, document: ContentBlock[]) {
    for (const id of uploadIdsInDocument(document)) {
      const existing = this.upload(id);
      if (!existing) continue;
      this.linkUpload({
        id,
        pageId,
        name: existing.name,
        mime: existing.mime,
        size: existing.size,
      });
    }
  }

  private linkUpload(input: {
    id: string;
    pageId: string;
    name: string;
    mime: string;
    size: number;
  }) {
    const page = this.db.prepare("SELECT 1 FROM pages WHERE id = ?").get(input.pageId);
    if (!page) return { ok: false as const, code: "missing-page" as const };
    this.db
      .prepare(
        `INSERT INTO uploads (id, page_id, name, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id, page_id) DO NOTHING`,
      )
      .run(input.id, input.pageId, input.name, input.mime, input.size, new Date().toISOString());
    return { ok: true as const, upload: this.upload(input.id)! };
  }

  hasPage(id: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM pages WHERE id = ?").get(id));
  }

  /** One stored file, by id. Any row will do: they all describe the same bytes. */
  upload(id: string): StoredUpload | null {
    const row = this.db
      .prepare("SELECT * FROM uploads WHERE id = ? ORDER BY created_at LIMIT 1")
      .get(id) as UploadRow | undefined;
    return row ? uploadFromRow(row) : null;
  }

  uploadsFor(pageId: string): StoredUpload[] {
    return (
      this.db
        .prepare("SELECT * FROM uploads WHERE page_id = ? ORDER BY created_at, id")
        .all(pageId) as unknown as UploadRow[]
    ).map(uploadFromRow);
  }

  /**
   * Erases a trashed page and everything under it. Trashing never touches
   * files, because a restore has to bring the page back whole; this is the only
   * path that lets any of them go, and it reports the files no surviving page
   * still refers to so the caller can unlink them.
   */
  deleteForever(id: string, revision: number) {
    return this.transaction(() => {
      const current = this.getAny(id);
      if (!current || !current.deletedAt || current.revision !== revision)
        return { ok: false as const, code: "stale" as const, current };
      return { ok: true as const, orphanedUploads: this.erase([id]) };
    });
  }

  /** Erases every trashed page in one go. */
  emptyTrash() {
    return this.transaction(() => {
      const roots = (
        this.db
          .prepare("SELECT id FROM pages WHERE deleted_at IS NOT NULL")
          .all() as unknown as { id: string }[]
      ).map((row) => row.id);
      return { ok: true as const, pages: roots.length, orphanedUploads: this.erase(roots) };
    });
  }

  /**
   * Deletes the given pages and their descendants, returning the upload ids no
   * remaining row references. Called inside a transaction; the files themselves
   * are unlinked afterwards, because a filesystem cannot be rolled back.
   */
  private erase(roots: string[]): string[] {
    if (!roots.length) return [];
    const placeholders = roots.map(() => "?").join(", ");
    const subtree = `WITH RECURSIVE doomed(id) AS (
        SELECT id FROM pages WHERE id IN (${placeholders})
        UNION SELECT pages.id FROM pages JOIN doomed ON pages.parent_id = doomed.id
      )`;
    const referenced = (
      this.db
        .prepare(
          `${subtree} SELECT DISTINCT id FROM uploads WHERE page_id IN (SELECT id FROM doomed)`,
        )
        .all(...roots) as unknown as { id: string }[]
    ).map((row) => row.id);
    // The uploads rows go with the pages through ON DELETE CASCADE.
    this.db.prepare(`${subtree} DELETE FROM pages WHERE id IN (SELECT id FROM doomed)`).run(...roots);
    const survives = this.db.prepare("SELECT 1 FROM uploads WHERE id = ? LIMIT 1");
    return referenced.filter((uploadId) => !survives.get(uploadId));
  }

  close() {
    this.db.close();
  }
}

let warnedAboutLegacyVariable = false;

/**
 * Where the Content database lives.
 *
 * `HQ_NOTES_DATABASE` still works, and a `data/notes.sqlite` left by the Notes
 * module is renamed rather than abandoned — a fresh, empty `content.sqlite`
 * beside the real pages would look exactly like data loss. The write-ahead log
 * moves with it, because the newest pages may only exist there.
 */
export function resolveContentDatabase(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const configured = env.HQ_CONTENT_DATABASE ?? env.HQ_NOTES_DATABASE;
  if (!env.HQ_CONTENT_DATABASE && env.HQ_NOTES_DATABASE && !warnedAboutLegacyVariable) {
    warnedAboutLegacyVariable = true;
    console.warn("HQ_NOTES_DATABASE is deprecated. Use HQ_CONTENT_DATABASE.");
  }
  if (configured) return resolve(cwd, configured);
  const path = resolve(cwd, "data/content.sqlite");
  const legacy = resolve(cwd, "data/notes.sqlite");
  if (!existsSync(path) && existsSync(legacy)) {
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(`${legacy}${suffix}`)) renameSync(`${legacy}${suffix}`, `${path}${suffix}`);
    console.info(`Renamed ${legacy} to ${path} for the Content module.`);
  }
  return path;
}

let store: ContentStore | undefined;
export function getContentStore() {
  return (store ??= new ContentStore(resolveContentDatabase()));
}

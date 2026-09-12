import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NoteBlock, NoteDetail, NotePage, SaveNoteInput } from "../lib/notes";

const emptyDocument = (): NoteBlock[] => [
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

type NoteRow = {
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
};

function textFromDocument(document: NoteBlock[]) {
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

function fromRow(row: NoteRow): NoteDetail {
  const document = JSON.parse(row.document) as NoteBlock[];
  return {
    id: row.id,
    title: row.title,
    document,
    parentId: row.parent_id,
    order: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    preview: textFromDocument(document).slice(0, 180),
  };
}

export class NotesStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        document TEXT NOT NULL,
        search_text TEXT NOT NULL,
        parent_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
        display_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        deletion_group TEXT
      );
      CREATE INDEX IF NOT EXISTS notes_parent_order ON notes(parent_id, display_order);
      CREATE INDEX IF NOT EXISTS notes_deleted_at ON notes(deleted_at);
    `);
  }

  list({ q, trashed = false }: { q?: string; trashed?: boolean } = {}): NotePage[] {
    const search = q?.trim().toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT * FROM notes
         WHERE deleted_at IS ${trashed ? "NOT NULL" : "NULL"}
           AND (? = '' OR instr(lower(title || ' ' || search_text), ?) > 0)
         ORDER BY display_order, created_at, id`,
      )
      .all(search ?? "", search ?? "") as unknown as NoteRow[];
    return rows.map(({ document: _document, ...row }) => {
      const detail = fromRow({ ...row, document: _document });
      const { document, ...page } = detail;
      return page;
    });
  }

  get(id: string): NoteDetail | null {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined;
    return row ? fromRow(row) : null;
  }

  create(title = "Untitled", parentId: string | null = null): NoteDetail {
    if (parentId) {
      const parent = this.get(parentId);
      if (!parent || parent.deletedAt) throw new Error("The parent page is not available.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const order = Number(
      (
        this.db
          .prepare("SELECT coalesce(max(display_order), -1) + 1 AS next_order FROM notes WHERE parent_id IS ?")
          .get(parentId) as { next_order: number }
      ).next_order,
    );
    this.db
      .prepare(
        `INSERT INTO notes
         (id, title, document, search_text, parent_id, display_order, created_at, updated_at, deleted_at, revision, deletion_group)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, NULL, 0, NULL)`,
      )
      .run(id, title, JSON.stringify(emptyDocument()), parentId, order, now, now);
    return this.get(id)!;
  }

  save(input: SaveNoteInput) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE notes SET title = ?, document = ?, search_text = ?, updated_at = ?, revision = revision + 1
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
      const current = this.get(input.id);
      if (!current) return { ok: false as const, code: "missing" as const, current };
      return current.deletedAt
        ? { ok: false as const, code: "trashed" as const, current }
        : { ok: false as const, code: "stale" as const, current };
    }
    return { ok: true as const, note: this.get(input.id)! };
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
             SELECT id FROM notes WHERE id = ?
             UNION ALL SELECT notes.id FROM notes JOIN descendants ON notes.parent_id = descendants.id
           )
           UPDATE notes SET deleted_at = ?, deletion_group = ?, updated_at = ?, revision = revision + 1
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
      const current = this.get(id);
      if (!current || !current.deletedAt || current.revision !== revision) {
        this.db.exec("ROLLBACK");
        return { ok: false as const, code: "stale" as const, current };
      }
      const now = new Date().toISOString();
      const batch = (
        this.db.prepare("SELECT deletion_group FROM notes WHERE id = ?").get(id) as {
          deletion_group: string;
        }
      ).deletion_group;
      this.db
        .prepare(
          `WITH RECURSIVE ancestors(id) AS (
             SELECT id FROM notes WHERE id = ?
             UNION SELECT notes.parent_id FROM notes JOIN ancestors ON notes.id = ancestors.id WHERE notes.parent_id IS NOT NULL
           ), descendants(id) AS (
             SELECT id FROM notes WHERE id = ?
             UNION ALL SELECT notes.id FROM notes JOIN descendants ON notes.parent_id = descendants.id
           )
           UPDATE notes SET deleted_at = NULL, deletion_group = NULL, updated_at = ?, revision = revision + 1
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

  close() {
    this.db.close();
  }
}

let store: NotesStore | undefined;
export function getNotesStore() {
  return (store ??= new NotesStore(resolve(process.env.HQ_NOTES_DATABASE ?? "data/notes.sqlite")));
}

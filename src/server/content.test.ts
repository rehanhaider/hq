import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ContentStore, resolveContentDatabase } from "./content";
import { createPageSchema, validateContentDocument } from "../lib/content";

let store: ContentStore;
afterEach(() => {
  store?.close();
  store = undefined!;
});

const paragraph = (text: string) => [
  {
    id: randomUUID(),
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: { bold: true } }],
    children: [],
  },
];

describe("content store", () => {
  it("keeps a lossless block document and finds body text", () => {
    store = new ContentStore(":memory:");
    const created = store.create("Ideas");
    const document = paragraph("A searchable thought");
    const saved = store.save({ id: created.id, title: created.title, revision: created.revision, document });
    expect(saved.ok).toBe(true);
    expect(store.get(created.id)?.document).toEqual(document);
    expect(store.list({ q: "searchable" }).map((page) => page.id)).toEqual([created.id]);
  });

  it("keeps an image's resized width across saves", () => {
    store = new ContentStore(":memory:");
    const created = store.create("Gallery");
    const imageDocument = (previewWidth: number) => [
      {
        id: randomUUID(),
        type: "image",
        props: {
          backgroundColor: "default",
          textAlignment: "left",
          name: "shot.png",
          url: "https://example.com/shot.png",
          caption: "",
          showPreview: true,
          previewWidth,
        },
        content: [],
        children: [],
      },
    ];
    const first = store.save({
      id: created.id,
      title: created.title,
      revision: created.revision,
      document: imageDocument(320),
    });
    expect(first.ok).toBe(true);
    expect(store.get(created.id)?.document[0]).toMatchObject({
      type: "image",
      props: expect.objectContaining({ previewWidth: 320 }),
    });
    // A drag-resize writes a new previewWidth; the next autosave must keep it.
    const current = store.get(created.id)!;
    const second = store.save({
      id: current.id,
      title: current.title,
      revision: current.revision,
      document: imageDocument(640),
    });
    expect(second.ok).toBe(true);
    expect(store.get(created.id)?.document[0]).toMatchObject({
      type: "image",
      props: expect.objectContaining({ previewWidth: 640 }),
    });
  });

  it("rejects stale writes instead of overwriting newer content", () => {
    store = new ContentStore(":memory:");
    const created = store.create("Draft");
    expect(store.save({ id: created.id, title: "First", revision: 0, document: paragraph("new") }).ok).toBe(true);
    const stale = store.save({ id: created.id, title: "Old", revision: 0, document: paragraph("old") });
    expect(stale).toMatchObject({ ok: false, code: "stale" });
    expect(store.get(created.id)).toMatchObject({ title: "First", revision: 1 });
    expect(store.get(created.id)?.preview).toBe("new");
  });

  it("trashes descendants and restores their ancestors and subtree", () => {
    store = new ContentStore(":memory:");
    const root = store.create("Root");
    const child = store.create("Child", root.id);
    const leaf = store.create("Leaf", child.id);
    expect(store.trash(root.id, root.revision).ok).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.list({ trashed: true })).toHaveLength(3);
    expect(store.get(child.id)).toBeNull();
    const trashedChild = store.list({ trashed: true }).find((page) => page.id === child.id)!;
    expect(store.restore(child.id, trashedChild.revision).ok).toBe(true);
    expect(store.get(root.id)?.deletedAt).toBeNull();
    expect(store.get(child.id)?.deletedAt).toBeNull();
    expect(store.get(leaf.id)?.deletedAt).toBeNull();
  });

  it("does not restore a descendant that was already in the trash", () => {
    store = new ContentStore(":memory:");
    const root = store.create("Root");
    const kept = store.create("Kept", root.id);
    const independentlyTrashed = store.create("Already trashed", root.id);
    store.trash(independentlyTrashed.id, independentlyTrashed.revision);
    store.trash(root.id, root.revision);
    const trashedRoot = store.list({ trashed: true }).find((page) => page.id === root.id)!;
    expect(store.restore(root.id, trashedRoot.revision).ok).toBe(true);
    expect(store.get(root.id)?.deletedAt).toBeNull();
    expect(store.get(kept.id)?.deletedAt).toBeNull();
    expect(store.get(independentlyTrashed.id)).toBeNull();
    expect(
      store.list({ trashed: true }).some((page) => page.id === independentlyTrashed.id),
    ).toBe(true);
  });

  it("hides trashed details while retaining them for restore and save conflicts", () => {
    store = new ContentStore(":memory:");
    const page = store.create("Private trash");
    expect(store.trash(page.id, page.revision).ok).toBe(true);
    expect(store.get(page.id)).toBeNull();
    const trashed = store.list({ trashed: true }).find((entry) => entry.id === page.id)!;
    expect(
      store.save({
        id: page.id,
        title: page.title,
        revision: trashed.revision,
        document: paragraph("kept locally"),
      }),
    ).toMatchObject({ ok: false, code: "trashed", current: { id: page.id } });
    expect(store.restore(page.id, trashed.revision).ok).toBe(true);
    expect(store.get(page.id)?.title).toBe("Private trash");
  });

  it("searches visible text without matching editor metadata", () => {
    store = new ContentStore(":memory:");
    const page = store.create("Ideas");
    expect(store.list({ q: "paragraph" })).toEqual([]);
    expect(store.list({ q: "default" })).toEqual([]);
    store.save({ id: page.id, title: page.title, revision: page.revision, document: paragraph("Visible body") });
    expect(store.list({ q: "visible" }).map((page) => page.id)).toEqual([page.id]);
  });

  it("searches body text beyond the list preview", () => {
    store = new ContentStore(":memory:");
    const page = store.create("Long page");
    const document = paragraph(`${"filler ".repeat(40)}find-me-at-the-end`);
    store.save({
      id: page.id,
      title: page.title,
      revision: page.revision,
      document,
    });
    expect(store.get(page.id)?.preview).not.toContain("find-me-at-the-end");
    expect(store.list({ q: "find-me-at-the-end" }).map((page) => page.id)).toEqual([
      page.id,
    ]);
  });

  it("lists metadata without loading or parsing documents", () => {
    store = new ContentStore(":memory:");
    const page = store.create("List row");
    store.db
      .prepare("UPDATE pages SET document = 'not json', search_text = 'Visible Preview' WHERE id = ?")
      .run(page.id);
    expect(store.list()).toEqual([
      expect.objectContaining({ id: page.id, preview: "Visible Preview" }),
    ]);
  });

  it("searches Unicode title and body text with one canonical normalization", () => {
    store = new ContentStore(":memory:");
    const page = store.create("E\u0301cole pages");
    const saved = store.save({
      id: page.id,
      title: page.title,
      revision: page.revision,
      document: paragraph("CAFÉ reference"),
    });
    expect(saved.ok).toBe(true);
    expect(store.list({ q: "éCOLE" }).map((page) => page.id)).toEqual([page.id]);
    expect(store.list({ q: "cafe\u0301" }).map((page) => page.id)).toEqual([page.id]);
    expect(store.list()[0]?.preview).toBe("CAFÉ reference");
  });

  it("does not create a child under a missing or trashed page", () => {
    store = new ContentStore(":memory:");
    expect(() => store.create("Child", randomUUID())).toThrow("parent page");
    const root = store.create("Root");
    store.trash(root.id, root.revision);
    expect(() => store.create("Child", root.id)).toThrow("parent page");
  });

  it("gives each new page its own initial block identity", () => {
    store = new ContentStore(":memory:");
    const first = store.create("First");
    const second = store.create("Second");
    expect(first.document[0]?.id).not.toBe(second.document[0]?.id);
  });

  it("creates a page with an empty title and keeps it empty after save", () => {
    store = new ContentStore(":memory:");
    const created = store.create();
    expect(created.title).toBe("");
    const saved = store.save({
      id: created.id,
      title: "",
      revision: created.revision,
      document: created.document,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.page.title).toBe("");
    expect(store.get(created.id)?.title).toBe("");
  });

  it("creates a populated recovery page in one insert", () => {
    store = new ContentStore(":memory:");
    const document = paragraph("Unsaved recovery text");
    const created = store.create("Recovered", null, document);
    expect(created).toMatchObject({
      title: "Recovered",
      revision: 0,
      preview: "Unsaved recovery text",
    });
    expect(created.document).toEqual(document);
    expect(store.list({ q: "recovery text" }).map((page) => page.id)).toEqual([
      created.id,
    ]);
  });
});

describe("page document validation", () => {
  it("validates recovery content before page creation", () => {
    expect(
      createPageSchema.safeParse({
        title: "Invalid recovery",
        parentId: null,
        document: [
          {
            id: randomUUID(),
            type: "image",
            props: {},
            content: undefined,
            children: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts supported formatting and safe links", () => {
    expect(
      validateContentDocument([
        {
          id: randomUUID(),
          type: "paragraph",
          props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
          content: [
            { type: "text", text: "HQ ", styles: { italic: true, underline: true } },
            { type: "link", href: "https://example.com", content: [{ type: "text", text: "link", styles: {} }] },
          ],
          children: [],
        },
      ]),
    ).toBe(true);
  });

  it("accepts BlockNote tables before and after JSON storage", () => {
    const table = [
      {
        id: randomUUID(),
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: [undefined, undefined],
          headerRows: 1,
          headerCols: undefined,
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    backgroundColor: "default",
                    textColor: "default",
                    textAlignment: "left",
                    colspan: 1,
                    rowspan: 1,
                  },
                  content: [{ type: "text", text: "Name", styles: { bold: true } }],
                },
              ],
            },
          ],
        },
        children: [],
      },
    ];
    expect(validateContentDocument(table)).toBe(true);
    expect(validateContentDocument(JSON.parse(JSON.stringify(table)))).toBe(true);
  });

  it("accepts an image, a video, and a file block", () => {
    const media = [
      {
        id: randomUUID(),
        type: "image",
        props: {
          backgroundColor: "default",
          textAlignment: "left",
          name: "shot.png",
          url: "/api/uploads/" + "a".repeat(64) + ".png",
          caption: "The board",
          showPreview: true,
          previewWidth: 512,
        },
        children: [],
      },
      {
        id: randomUUID(),
        type: "video",
        props: {
          backgroundColor: "default",
          textAlignment: "left",
          name: "clip.mp4",
          url: "/api/uploads/" + "b".repeat(64) + ".mp4",
          caption: "",
          showPreview: true,
          previewWidth: undefined,
        },
        children: [],
      },
      {
        id: randomUUID(),
        type: "file",
        props: {
          backgroundColor: "default",
          name: "plan.pdf",
          url: "https://example.com/plan.pdf",
          caption: "",
        },
        children: [],
      },
    ];
    expect(validateContentDocument(media)).toBe(true);
    expect(validateContentDocument(JSON.parse(JSON.stringify(media)))).toBe(true);
  });

  it("rejects malformed media blocks, unsafe links, and unknown fields", () => {
    expect(
      validateContentDocument([
        { id: randomUUID(), type: "image", props: {}, content: undefined, children: [] },
      ]),
    ).toBe(false);
    expect(
      validateContentDocument([
        {
          id: randomUUID(),
          type: "image",
          props: {
            backgroundColor: "default",
            textAlignment: "left",
            name: "shot.png",
            url: "javascript:alert(1)",
            caption: "",
            showPreview: true,
            previewWidth: 512,
          },
          children: [],
        },
      ]),
    ).toBe(false);
    expect(
      validateContentDocument([
        {
          id: randomUUID(),
          type: "audio",
          props: { backgroundColor: "default", name: "podcast.mp3", url: "", caption: "" },
          children: [],
        },
      ]),
    ).toBe(false);
    expect(
      validateContentDocument([
        {
          id: randomUUID(),
          type: "paragraph",
          props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
          content: [{ type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "bad", styles: {} }] }],
          children: [],
        },
      ]),
    ).toBe(false);
  });
});

describe("content migration", () => {
  let directory: string;
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined!;
  });

  const legacyDatabase = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE notes (
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
      CREATE INDEX notes_parent_order ON notes(parent_id, display_order);
      INSERT INTO notes VALUES
        ('11111111-1111-4111-8111-111111111111', 'Older page', '[]', 'body', NULL, 0,
         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 3, NULL),
        ('22222222-2222-4222-8222-222222222222', 'Newer page', '[]', 'body', NULL, 1,
         '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL, 0, NULL);
    `);
    db.close();
  };

  it("seeds the default statuses and types once", () => {
    store = new ContentStore(":memory:");
    const properties = store.properties();
    expect(properties.statuses.map((status) => status.name)).toEqual([
      "Idea",
      "Planned",
      "Drafting",
      "Recorded",
      "Editing",
      "Scheduled",
      "Published",
      "Archived",
    ]);
    expect(properties.types.map((type) => type.name)).toEqual([
      "Stream",
      "YouTube video",
      "Blog post",
      "Architecture article",
    ]);
    expect(properties.tags).toEqual([]);
  });

  it("carries a Notes database forward and gives every page the first status", () => {
    directory = mkdtempSync(join(tmpdir(), "hq-content-"));
    const path = join(directory, "data", "content.sqlite");
    legacyDatabase(path);
    store = new ContentStore(path);
    const pages = store.list();
    const first = store.properties().statuses[0]!;
    expect(first.name).toBe("Idea");
    expect(pages.map((page) => [page.title, page.statusId, page.typeId, page.tagIds])).toEqual([
      ["Older page", first.id, null, []],
      ["Newer page", first.id, null, []],
    ]);
    // Oldest first, and distinct, so manual ordering starts from real order.
    expect(pages[0]!.position).toBeLessThan(pages[1]!.position);
    // Documents, revisions, and the tree survive the rename.
    expect(pages[0]!.revision).toBe(3);
  });

  it("does not reseed properties the user has removed", () => {
    directory = mkdtempSync(join(tmpdir(), "hq-content-"));
    const path = join(directory, "content.sqlite");
    store = new ContentStore(path);
    for (const type of store.properties().types)
      expect(store.deleteProperty("type", type.id).ok).toBe(true);
    store.close();
    store = new ContentStore(path);
    expect(store.properties().types).toEqual([]);
    expect(store.properties().statuses).toHaveLength(8);
  });

  it("renames a Notes database, and its write-ahead log, on start", () => {
    directory = mkdtempSync(join(tmpdir(), "hq-content-"));
    mkdirSync(join(directory, "data"));
    writeFileSync(join(directory, "data", "notes.sqlite"), "main");
    writeFileSync(join(directory, "data", "notes.sqlite-wal"), "log");
    const path = resolveContentDatabase({}, directory);
    expect(path).toBe(join(directory, "data", "content.sqlite"));
    expect(readFileSync(path, "utf8")).toBe("main");
    expect(readFileSync(`${path}-wal`, "utf8")).toBe("log");
    expect(existsSync(join(directory, "data", "notes.sqlite"))).toBe(false);
    // A second start finds the new name and leaves it alone.
    expect(resolveContentDatabase({}, directory)).toBe(path);
  });

  it("prefers HQ_CONTENT_DATABASE and still honours the deprecated variable", () => {
    directory = mkdtempSync(join(tmpdir(), "hq-content-"));
    expect(resolveContentDatabase({ HQ_CONTENT_DATABASE: "chosen.sqlite" }, directory)).toBe(
      join(directory, "chosen.sqlite"),
    );
    expect(resolveContentDatabase({ HQ_NOTES_DATABASE: "legacy.sqlite" }, directory)).toBe(
      join(directory, "legacy.sqlite"),
    );
  });
});

describe("content properties", () => {
  it("moves pages to another status rather than deleting them", () => {
    store = new ContentStore(":memory:");
    const [idea, planned] = store.properties().statuses;
    const page = store.create("Stream plan");
    expect(page.statusId).toBe(idea!.id);
    expect(store.deleteProperty("status", idea!.id)).toMatchObject({
      ok: false,
      code: "pages",
      pages: 1,
    });
    expect(store.properties().statuses).toHaveLength(8);
    expect(store.deleteProperty("status", idea!.id, planned!.id).ok).toBe(true);
    expect(store.get(page.id)?.statusId).toBe(planned!.id);
    expect(store.properties().statuses).toHaveLength(7);
  });

  it("refuses to delete the last status", () => {
    store = new ContentStore(":memory:");
    const statuses = store.properties().statuses;
    const kept = statuses[0]!;
    for (const status of statuses.slice(1))
      expect(store.deleteProperty("status", status.id).ok).toBe(true);
    expect(store.deleteProperty("status", kept.id)).toMatchObject({
      ok: false,
      code: "last",
    });
  });

  it("clears a deleted type and unlinks a deleted tag", () => {
    store = new ContentStore(":memory:");
    const type = store.properties().types[0]!;
    const tag = store.createProperty("tag", "series");
    const page = store.create("Episode");
    expect(
      store.setProperties({ id: page.id, typeId: type.id, tagIds: [tag.id] }).ok,
    ).toBe(true);
    expect(store.get(page.id)).toMatchObject({ typeId: type.id, tagIds: [tag.id] });
    expect(store.deleteProperty("type", type.id).ok).toBe(true);
    expect(store.deleteProperty("tag", tag.id).ok).toBe(true);
    expect(store.get(page.id)).toMatchObject({ typeId: null, tagIds: [] });
  });

  it("saves properties without touching the document revision", () => {
    store = new ContentStore(":memory:");
    const page = store.create("Draft");
    const [, planned] = store.properties().statuses;
    expect(store.setProperties({ id: page.id, statusId: planned!.id }).ok).toBe(true);
    const after = store.get(page.id)!;
    expect(after.revision).toBe(page.revision);
    expect(after.statusId).toBe(planned!.id);
    // The editor's next autosave still applies against the revision it holds.
    expect(store.save({ id: page.id, title: "Draft", revision: page.revision, document: paragraph("still mine") }).ok).toBe(true);
  });

  it("gives a subpage its parent's type and the first status", () => {
    store = new ContentStore(":memory:");
    const type = store.properties().types[1]!;
    const parent = store.create("Series");
    store.setProperties({ id: parent.id, typeId: type.id });
    const child = store.create("Episode 1", parent.id);
    expect(child.typeId).toBe(type.id);
    expect(child.statusId).toBe(store.properties().statuses[0]!.id);
  });

  it("reuses a tag that already exists instead of creating a duplicate", () => {
    store = new ContentStore(":memory:");
    const first = store.createProperty("tag", "sqlite");
    const again = store.createProperty("tag", "SQLite");
    expect(again.id).toBe(first.id);
    expect(again.created).toBe(false);
    expect(store.properties().tags).toHaveLength(1);
  });

  it("refuses a rename onto another entry's name, whatever its case", () => {
    store = new ContentStore(":memory:");
    const [idea, planned] = store.properties().statuses;
    expect(store.updateProperty("status", planned!.id, { name: "idea" })).toMatchObject({
      ok: false,
      code: "duplicate",
    });
    expect(store.properties().statuses[1]!.name).toBe("Planned");
    // Recasing an entry's own name is still a rename, not a duplicate.
    expect(store.updateProperty("status", idea!.id, { name: "IDEA" }).ok).toBe(true);
  });

  it("adds a new property after the last one, even once the list has gaps", () => {
    store = new ContentStore(":memory:");
    const types = store.properties().types;
    expect(store.deleteProperty("type", types[1]!.id).ok).toBe(true);
    const added = store.createProperty("type", "Newsletter");
    const list = store.properties().types;
    expect(list.at(-1)!.id).toBe(added.id);
    expect(new Set(list.map((entry) => entry.position)).size).toBe(list.length);
  });

  it("reorders property lists", () => {
    store = new ContentStore(":memory:");
    const statuses = store.properties().statuses;
    const reversed = [...statuses].reverse().map((status) => status.id);
    expect(store.reorderProperties("status", reversed).ok).toBe(true);
    expect(store.properties().statuses.map((status) => status.id)).toEqual(reversed);
  });
});

describe("board moves", () => {
  it("persists a manual order and a column change together", () => {
    store = new ContentStore(":memory:");
    const [idea, planned] = store.properties().statuses;
    const first = store.create("First");
    const second = store.create("Second");
    const third = store.create("Third");
    expect(
      store.moveCard({
        id: third.id,
        statusId: planned!.id,
        orderedIds: [third.id],
      }).ok,
    ).toBe(true);
    expect(store.get(third.id)?.statusId).toBe(planned!.id);

    // Dragging Second above First inside the Idea column.
    expect(
      store.moveCard({
        id: second.id,
        statusId: idea!.id,
        orderedIds: [second.id, first.id],
      }).ok,
    ).toBe(true);
    const byPosition = store
      .list()
      .filter((page) => page.statusId === idea!.id)
      .sort((a, b) => a.position - b.position)
      .map((page) => page.title);
    expect(byPosition).toEqual(["Second", "First"]);

    // And it survives a restart of the store.
    const positions = new Map(store.list().map((page) => [page.title, page.position]));
    expect(positions.get("Second")).toBeLessThan(positions.get("First")!);
  });

  it("keeps every position distinct, so one column's order cannot scramble another's", () => {
    store = new ContentStore(":memory:");
    const [idea, planned] = store.properties().statuses;
    const a = store.create("A");
    const b = store.create("B");
    const c = store.create("C");
    const d = store.create("D");
    for (const page of [c, d])
      store.moveCard({ id: page.id, statusId: planned!.id, orderedIds: [c.id, d.id] });
    // Reordering the Idea column must not hand its pages positions that the
    // Planned column is already using: grouped by type, all four share one
    // column, and the manual order there has to stay readable.
    store.moveCard({ id: b.id, statusId: idea!.id, orderedIds: [b.id, a.id] });
    const positions = store.list().map((page) => page.position);
    expect(new Set(positions).size).toBe(4);
    const order = store
      .list()
      .sort((left, right) => left.position - right.position)
      .map((page) => page.title);
    expect(order).toEqual(["B", "A", "C", "D"]);
  });

  it("leaves pages a filter is hiding where they were", () => {
    store = new ContentStore(":memory:");
    const [idea] = store.properties().statuses;
    const first = store.create("First");
    const hidden = store.create("Hidden");
    const last = store.create("Last");
    const before = store.get(hidden.id)!.position;
    // Only the two visible cards are dragged, so only their two slots move.
    store.moveCard({ id: last.id, statusId: idea!.id, orderedIds: [last.id, first.id] });
    expect(store.get(hidden.id)!.position).toBe(before);
    expect(store.get(last.id)!.position).toBeLessThan(store.get(first.id)!.position);
  });

  it("keeps a rejected move whole instead of half-applying it", () => {
    store = new ContentStore(":memory:");
    const [, planned] = store.properties().statuses;
    const tag = store.createProperty("tag", "stream");
    const page = store.create("Crossover", null, undefined, null, null, [tag.id]);
    // The destination tag is gone, so nothing about this move may land — least
    // of all the removal of the tag the card was dragged out of.
    expect(
      store.moveCard({
        id: page.id,
        statusId: planned!.id,
        removeTagId: tag.id,
        addTagId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "unknown-tag" });
    const after = store.get(page.id)!;
    expect(after.tagIds).toEqual([tag.id]);
    expect(after.statusId).toBe(store.properties().statuses[0]!.id);
  });

  it("clears every tag when a card is dropped on Untagged", () => {
    store = new ContentStore(":memory:");
    const one = store.createProperty("tag", "stream");
    const two = store.createProperty("tag", "article");
    const page = store.create("Crossover", null, undefined, null, null, [one.id, two.id]);
    expect(store.moveCard({ id: page.id, tagIds: [] }).ok).toBe(true);
    expect(store.get(page.id)?.tagIds).toEqual([]);
  });

  it("rejects a move to a status that does not exist", () => {
    store = new ContentStore(":memory:");
    const page = store.create("Card");
    expect(store.moveCard({ id: page.id, statusId: randomUUID() })).toMatchObject({
      ok: false,
      code: "unknown-status",
    });
    expect(store.get(page.id)?.statusId).toBe(store.properties().statuses[0]!.id);
  });

  it("adds and removes a tag when a card is dragged between tag columns", () => {
    store = new ContentStore(":memory:");
    const from = store.createProperty("tag", "stream");
    const to = store.createProperty("tag", "article");
    const page = store.create("Crossover");
    store.setProperties({ id: page.id, tagIds: [from.id] });
    expect(
      store.moveCard({ id: page.id, removeTagId: from.id, addTagId: to.id }).ok,
    ).toBe(true);
    expect(store.get(page.id)?.tagIds).toEqual([to.id]);
  });
});

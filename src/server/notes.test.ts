import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NotesStore } from "./notes";
import { validateNoteDocument } from "../lib/notes";

let store: NotesStore;
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

describe("notes store", () => {
  it("keeps a lossless block document and finds body text", () => {
    store = new NotesStore(":memory:");
    const created = store.create("Ideas");
    const document = paragraph("A searchable thought");
    const saved = store.save({ id: created.id, title: created.title, revision: created.revision, document });
    expect(saved.ok).toBe(true);
    expect(store.get(created.id)?.document).toEqual(document);
    expect(store.list({ q: "searchable" }).map((page) => page.id)).toEqual([created.id]);
  });

  it("rejects stale writes instead of overwriting newer content", () => {
    store = new NotesStore(":memory:");
    const created = store.create("Draft");
    expect(store.save({ id: created.id, title: "First", revision: 0, document: paragraph("new") }).ok).toBe(true);
    const stale = store.save({ id: created.id, title: "Old", revision: 0, document: paragraph("old") });
    expect(stale).toMatchObject({ ok: false, code: "stale" });
    expect(store.get(created.id)).toMatchObject({ title: "First", revision: 1 });
    expect(store.get(created.id)?.preview).toBe("new");
  });

  it("trashes descendants and restores their ancestors and subtree", () => {
    store = new NotesStore(":memory:");
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
    store = new NotesStore(":memory:");
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
    store = new NotesStore(":memory:");
    const note = store.create("Private trash");
    expect(store.trash(note.id, note.revision).ok).toBe(true);
    expect(store.get(note.id)).toBeNull();
    const trashed = store.list({ trashed: true }).find((page) => page.id === note.id)!;
    expect(
      store.save({
        id: note.id,
        title: note.title,
        revision: trashed.revision,
        document: paragraph("kept locally"),
      }),
    ).toMatchObject({ ok: false, code: "trashed", current: { id: note.id } });
    expect(store.restore(note.id, trashed.revision).ok).toBe(true);
    expect(store.get(note.id)?.title).toBe("Private trash");
  });

  it("searches visible text without matching editor metadata", () => {
    store = new NotesStore(":memory:");
    const note = store.create("Ideas");
    expect(store.list({ q: "paragraph" })).toEqual([]);
    expect(store.list({ q: "default" })).toEqual([]);
    store.save({ id: note.id, title: note.title, revision: note.revision, document: paragraph("Visible body") });
    expect(store.list({ q: "visible" }).map((page) => page.id)).toEqual([note.id]);
  });

  it("searches body text beyond the list preview", () => {
    store = new NotesStore(":memory:");
    const note = store.create("Long page");
    const document = paragraph(`${"filler ".repeat(40)}find-me-at-the-end`);
    store.save({
      id: note.id,
      title: note.title,
      revision: note.revision,
      document,
    });
    expect(store.get(note.id)?.preview).not.toContain("find-me-at-the-end");
    expect(store.list({ q: "find-me-at-the-end" }).map((page) => page.id)).toEqual([
      note.id,
    ]);
  });

  it("lists metadata without loading or parsing documents", () => {
    store = new NotesStore(":memory:");
    const note = store.create("List row");
    store.db
      .prepare("UPDATE notes SET document = 'not json', search_text = 'Visible Preview' WHERE id = ?")
      .run(note.id);
    expect(store.list()).toEqual([
      expect.objectContaining({ id: note.id, preview: "Visible Preview" }),
    ]);
  });

  it("searches Unicode title and body text with one canonical normalization", () => {
    store = new NotesStore(":memory:");
    const note = store.create("E\u0301cole notes");
    const saved = store.save({
      id: note.id,
      title: note.title,
      revision: note.revision,
      document: paragraph("CAFÉ reference"),
    });
    expect(saved.ok).toBe(true);
    expect(store.list({ q: "éCOLE" }).map((page) => page.id)).toEqual([note.id]);
    expect(store.list({ q: "cafe\u0301" }).map((page) => page.id)).toEqual([note.id]);
    expect(store.list()[0]?.preview).toBe("CAFÉ reference");
  });

  it("does not create a child under a missing or trashed page", () => {
    store = new NotesStore(":memory:");
    expect(() => store.create("Child", randomUUID())).toThrow("parent page");
    const root = store.create("Root");
    store.trash(root.id, root.revision);
    expect(() => store.create("Child", root.id)).toThrow("parent page");
  });

  it("gives each new page its own initial block identity", () => {
    store = new NotesStore(":memory:");
    const first = store.create("First");
    const second = store.create("Second");
    expect(first.document[0]?.id).not.toBe(second.document[0]?.id);
  });
});

describe("note document validation", () => {
  it("accepts supported formatting and safe links", () => {
    expect(
      validateNoteDocument([
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
    expect(validateNoteDocument(table)).toBe(true);
    expect(validateNoteDocument(JSON.parse(JSON.stringify(table)))).toBe(true);
  });

  it("rejects media blocks, unsafe links, and unknown fields", () => {
    expect(
      validateNoteDocument([
        { id: randomUUID(), type: "image", props: {}, content: undefined, children: [] },
      ]),
    ).toBe(false);
    expect(
      validateNoteDocument([
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

import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentStore } from "./content";
import { UploadStore, resolveUploadsDirectory } from "./uploads";
import { MAX_UPLOAD_BYTES } from "../lib/uploads";

let content: ContentStore;
let directory: string;

function uploads() {
  content = new ContentStore(":memory:");
  directory = mkdtempSync(join(tmpdir(), "hq-uploads-"));
  return new UploadStore(content, directory);
}

afterEach(() => {
  content?.close();
  content = undefined!;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined!;
});

// A one-pixel PNG, so the bytes are a real file rather than a string.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const files = () => readdirSync(directory).sort();

describe("upload store", () => {
  it("stores a file under the hash of its bytes", () => {
    const store = uploads();
    const page = content.create("Stream plan");
    const result = store.save({
      bytes: png,
      name: "shot.png",
      mime: "image/png",
      pageId: page.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hash = createHash("sha256").update(png).digest("hex");
    expect(result.upload.id).toBe(`${hash}.png`);
    expect(result.url).toBe(`/api/uploads/${hash}.png`);
    expect(files()).toEqual([`${hash}.png`]);
    expect(readFileSync(store.path(result.upload.id))).toEqual(png);
    expect(store.read(result.upload.id)?.upload.mime).toBe("image/png");
  });

  it("refuses a type it does not serve, and says why", () => {
    const store = uploads();
    const page = content.create("Stream plan");
    const rejected = store.save({
      bytes: png,
      name: "podcast.mp3",
      mime: "audio/mpeg",
      pageId: page.id,
    });
    expect(rejected).toMatchObject({ ok: false, status: 415 });
    if (rejected.ok) return;
    expect(rejected.error).toContain("audio/mpeg");
    expect(files()).toEqual([]);
  });

  it("refuses a file over the size limit", () => {
    const store = uploads();
    const page = content.create("Stream plan");
    const rejected = store.save({
      bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
      name: "long.mp4",
      mime: "video/mp4",
      pageId: page.id,
    });
    expect(rejected).toMatchObject({ ok: false, status: 413 });
    expect(files()).toEqual([]);
  });

  it("takes the extension from the type when the name offers none it knows", () => {
    const store = uploads();
    const page = content.create("Stream plan");
    const result = store.save({
      bytes: png,
      name: "payload.sh",
      mime: "image/png",
      pageId: page.id,
    });
    expect(result.ok && result.upload.id.endsWith(".png")).toBe(true);
  });

  it("stores identical bytes once and links them to each page", () => {
    const store = uploads();
    const first = content.create("Stream plan");
    const second = content.create("Blog post");
    const a = store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: first.id });
    const b = store.save({ bytes: png, name: "same.png", mime: "image/png", pageId: second.id });
    expect(a.ok && b.ok && a.upload.id === b.upload.id).toBe(true);
    expect(files()).toHaveLength(1);
    expect(content.uploadsFor(first.id)).toHaveLength(1);
    expect(content.uploadsFor(second.id)).toHaveLength(1);
  });

  it("keeps a trashed page's files, so a restore brings the page back whole", () => {
    const store = uploads();
    const page = content.create("Stream plan");
    const saved = store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: page.id });
    expect(saved.ok).toBe(true);
    const trashed = content.get(page.id)!;
    expect(content.trash(trashed.id, trashed.revision).ok).toBe(true);
    expect(files()).toHaveLength(1);
    const inTrash = content.list({ trashed: true })[0]!;
    expect(content.restore(inTrash.id, inTrash.revision).ok).toBe(true);
    expect(content.uploadsFor(page.id)).toHaveLength(1);
  });

  it("keeps a copied page's files when the original is deleted for good", () => {
    // Save-as-new-page and a pasted block copy the URL without posting the
    // file again. The copy still shows the picture, so erase must see its row.
    const store = uploads();
    const original = content.create("Stream plan");
    const saved = store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: original.id });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const document = [
      {
        id: randomUUID(),
        type: "image",
        props: {
          backgroundColor: "default",
          textAlignment: "left",
          name: "shot.png",
          url: saved.url,
          caption: "",
          showPreview: true,
          previewWidth: 512,
        },
        children: [],
      },
    ];
    const copy = content.create("Copy", null, document);
    expect(content.uploadsFor(copy.id).map((item) => item.id)).toEqual([saved.upload.id]);

    const blank = content.create("Blank");
    expect(
      content.save({
        id: blank.id,
        title: blank.title,
        revision: blank.revision,
        document,
      }).ok,
    ).toBe(true);
    expect(content.uploadsFor(blank.id).map((item) => item.id)).toEqual([saved.upload.id]);

    const page = content.get(original.id)!;
    expect(content.trash(page.id, page.revision).ok).toBe(true);
    const trashed = content.list({ trashed: true })[0]!;
    expect(store.deletePageForever(trashed.id, trashed.revision).ok).toBe(true);
    expect(existsSync(store.path(saved.upload.id))).toBe(true);
    expect(store.read(saved.upload.id)?.upload).toBeTruthy();
  });

  it("deletes a page's files for good, unless another page still uses them", () => {
    const store = uploads();
    const shared = content.create("Stream plan");
    const other = content.create("Blog post");
    const own = Buffer.from("a private attachment", "utf8");
    const sharedResult = store.save({
      bytes: png,
      name: "shot.png",
      mime: "image/png",
      pageId: shared.id,
    });
    store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: other.id });
    const ownResult = store.save({
      bytes: own,
      name: "notes.txt",
      mime: "text/plain",
      pageId: shared.id,
    });
    expect(sharedResult.ok && ownResult.ok).toBe(true);
    if (!sharedResult.ok || !ownResult.ok) return;

    const page = content.get(shared.id)!;
    expect(content.trash(page.id, page.revision).ok).toBe(true);
    const trashed = content.list({ trashed: true })[0]!;
    expect(store.deletePageForever(trashed.id, trashed.revision).ok).toBe(true);

    expect(content.uploadsFor(shared.id)).toEqual([]);
    expect(existsSync(store.path(ownResult.upload.id))).toBe(false);
    expect(existsSync(store.path(sharedResult.upload.id))).toBe(true);
    expect(content.uploadsFor(other.id)).toHaveLength(1);
  });

  it("deletes a subpage's files with its parent, and refuses a stale revision", () => {
    const store = uploads();
    const parent = content.create("Stream plan");
    const child = content.create("Shot list", parent.id);
    const saved = store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: child.id });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const page = content.get(parent.id)!;
    expect(content.trash(page.id, page.revision).ok).toBe(true);
    const trashed = content.list({ trashed: true }).find((item) => item.id === parent.id)!;
    expect(store.deletePageForever(trashed.id, trashed.revision + 5)).toMatchObject({
      ok: false,
      code: "stale",
    });
    expect(store.deletePageForever(trashed.id, trashed.revision).ok).toBe(true);
    expect(content.list({ trashed: true })).toEqual([]);
    expect(files()).toEqual([]);
  });

  it("empties the trash and lets go of everything only it held", () => {
    const store = uploads();
    const kept = content.create("Blog post");
    const going = content.create("Stream plan");
    store.save({ bytes: png, name: "shot.png", mime: "image/png", pageId: kept.id });
    const only = store.save({
      bytes: Buffer.from("only here", "utf8"),
      name: "notes.txt",
      mime: "text/plain",
      pageId: going.id,
    });
    const page = content.get(going.id)!;
    expect(content.trash(page.id, page.revision).ok).toBe(true);
    expect(store.emptyTrash()).toMatchObject({ ok: true, pages: 1 });
    expect(content.list({ trashed: true })).toEqual([]);
    expect(content.list().map((item) => item.id)).toEqual([kept.id]);
    expect(only.ok && existsSync(store.path(only.upload.id))).toBe(false);
    expect(files()).toHaveLength(1);
  });

  it("has nothing to serve for an unknown or malformed id", () => {
    const store = uploads();
    expect(store.read("../../etc/passwd")).toBeNull();
    expect(store.read(`${"a".repeat(64)}.png`)).toBeNull();
  });

  it("refuses a file for a page that is gone", () => {
    const store = uploads();
    expect(
      store.save({
        bytes: png,
        name: "shot.png",
        mime: "image/png",
        pageId: "c0ffee00-0000-4000-8000-000000000000",
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});

describe("resolveUploadsDirectory", () => {
  it("defaults beside the databases and follows HQ_UPLOADS_DIR", () => {
    expect(resolveUploadsDirectory({}, "/srv/hq")).toBe("/srv/hq/data/uploads");
    expect(resolveUploadsDirectory({ HQ_UPLOADS_DIR: "media" }, "/srv/hq")).toBe("/srv/hq/media");
    expect(resolveUploadsDirectory({ HQ_UPLOADS_DIR: "/mnt/media" }, "/srv/hq")).toBe(
      "/mnt/media",
    );
  });
});

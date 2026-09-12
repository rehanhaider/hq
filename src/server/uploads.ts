import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_NAME_LENGTH,
  isAllowedUploadMime,
  isUploadId,
  uploadDisplayName,
  uploadExtension,
  uploadRejection,
  uploadUrl,
} from "../lib/uploads";
import type { StoredUpload } from "../lib/content";
import { ContentStore, getContentStore } from "./content";

export type UploadResult =
  | { ok: true; upload: StoredUpload; url: string }
  | { ok: false; status: number; error: string };

/**
 * The files pages link to. They live beside the database rather than inside it:
 * a video in a SQLite row would be read into memory to serve one byte range,
 * and every backup would rewrite it.
 *
 * A file is named by the hash of its own bytes, so the same picture pasted into
 * three pages is stored once and every URL for it can be cached forever.
 */
export class UploadStore {
  constructor(
    private readonly content: ContentStore,
    readonly directory: string,
  ) {}

  path(id: string) {
    return join(this.directory, id);
  }

  /**
   * Validates, then writes the bytes and records the row. The write is atomic —
   * a temporary name, renamed into place — so a half-written file can never be
   * served under a hash that claims to describe it.
   */
  save(input: {
    bytes: Uint8Array;
    name: string;
    mime: string;
    pageId: string;
  }): UploadResult {
    const name = uploadDisplayName(input.name);
    const mime = input.mime.split(";")[0]!.trim().toLowerCase();
    const size = input.bytes.byteLength;
    const rejection = uploadRejection({ name, mime, size });
    if (rejection)
      return {
        ok: false,
        status: size > MAX_UPLOAD_BYTES ? 413 : isAllowedUploadMime(mime) ? 400 : 415,
        error: rejection,
      };

    const id = `${createHash("sha256").update(input.bytes).digest("hex")}.${uploadExtension(name, mime)}`;
    const target = this.path(id);
    if (!existsSync(target)) {
      mkdirSync(this.directory, { recursive: true });
      const staged = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(staged, input.bytes, { flag: "wx" });
        renameSync(staged, target);
      } catch (error) {
        rmSync(staged, { force: true });
        throw error;
      }
    }

    const recorded = this.content.recordUpload({ id, pageId: input.pageId, name, mime, size });
    if (!recorded.ok)
      return { ok: false, status: 404, error: "That page is no longer available." };
    return { ok: true, upload: recorded.upload, url: uploadUrl(id) };
  }

  /** What is needed to serve a file: its row and a readable path. Null if unknown. */
  read(id: string) {
    if (!isUploadId(id)) return null;
    const upload = this.content.upload(id);
    if (!upload) return null;
    const path = this.path(id);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return null;
    }
    return { upload, path, size };
  }

  /**
   * Unlinks files nothing points at any more. The rows are gone by the time
   * this runs, so it re-checks each id: a page deleted while another still
   * shows the same picture must not take that picture with it.
   */
  purge(ids: string[]) {
    let removed = 0;
    for (const id of new Set(ids)) {
      if (!isUploadId(id) || this.content.upload(id)) continue;
      rmSync(this.path(id), { force: true });
      removed += 1;
    }
    return removed;
  }

  /** Permanently deletes a trashed page, then lets go of the files it held. */
  deletePageForever(id: string, revision: number) {
    const result = this.content.deleteForever(id, revision);
    if (result.ok) this.purge(result.orphanedUploads);
    return result;
  }

  emptyTrash() {
    const result = this.content.emptyTrash();
    this.purge(result.orphanedUploads);
    return { ok: true as const, pages: result.pages };
  }
}

/**
 * Where uploaded files live. `HQ_UPLOADS_DIR` moves them, the way the database
 * variables move a database; the backup script reads the same variable.
 */
export function resolveUploadsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  return resolve(cwd, env.HQ_UPLOADS_DIR ?? "data/uploads");
}

let store: UploadStore | undefined;
export function getUploadStore() {
  return (store ??= new UploadStore(getContentStore(), resolveUploadsDirectory()));
}

/** Pulls one upload out of a multipart request body. */
export async function uploadFromRequest(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const pageId = form.get("pageId");
  if (!(file instanceof File)) return { ok: false as const, error: "No file was sent." };
  if (typeof pageId !== "string" || !pageId)
    return { ok: false as const, error: "No page was named for this file." };
  return {
    ok: true as const,
    file,
    pageId,
    name: file.name.slice(0, MAX_UPLOAD_NAME_LENGTH * 2),
    mime: file.type,
  };
}

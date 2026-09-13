/**
 * What the Content editor is allowed to attach, shared by the browser and the
 * upload endpoint. The endpoint is the authority — the editor only uses these
 * to fail fast and to say why in the same words the server would.
 */

/** 25 MB. Large enough for a screen recording clip, small enough to back up. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Multipart Content-Length. Null means the body must not be read: missing,
 * zero, or not a whole number of bytes, so a chunked or undeclared request
 * cannot fill memory before the size check runs.
 */
export function declaredUploadBytes(header: string | null) {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Images and videos are taken by family, because the editor renders whatever
 * the browser can. Everything else is a named list: a page attachment should be
 * a document, not an arbitrary executable.
 */
export const ALLOWED_FILE_MIMES = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
]);

/** The extension a stored file takes when its name does not offer a usable one. */
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

/**
 * Extensions a stored file may wear. The name a browser hands over is not
 * trusted beyond this list, so an upload can never land on disk as `.sh`.
 */
const ALLOWED_EXTENSIONS = new Set([
  ...Object.values(MIME_EXTENSIONS),
  "jpeg",
  "ico",
  "heic",
  "heif",
  "m4v",
  "mpeg",
  "mpg",
  "tif",
]);

export const MAX_UPLOAD_NAME_LENGTH = 200;

/** `<sha256>.<ext>`: the row id, the file name on disk, and the URL segment. */
export const UPLOAD_ID_PATTERN = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

export function isUploadId(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

export function isAllowedUploadMime(mime: string) {
  return (
    mime.startsWith("image/") || mime.startsWith("video/") || ALLOWED_FILE_MIMES.has(mime)
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The reason an upload is refused, in the words the editor shows. Null if it is fine. */
export function uploadRejection(input: { name: string; mime: string; size: number }) {
  if (!input.name.trim()) return "This file has no name.";
  if (input.size <= 0) return "This file is empty.";
  if (input.size > MAX_UPLOAD_BYTES)
    return `This file is ${formatBytes(input.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  if (!isAllowedUploadMime(input.mime))
    return `${input.mime || "This file type"} cannot be attached. Images, videos, PDFs, documents, text, and zip files can.`;
  return null;
}

/** A display name, trimmed of any path the browser included. */
export function uploadDisplayName(name: string) {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  return (base || "file").slice(0, MAX_UPLOAD_NAME_LENGTH);
}

/**
 * The extension the stored file takes: the uploaded name's, when it is one we
 * recognise, and otherwise the one its type implies.
 */
export function uploadExtension(name: string, mime: string) {
  const named = /\.([A-Za-z0-9]{1,8})$/.exec(uploadDisplayName(name))?.[1]?.toLowerCase();
  if (named && ALLOWED_EXTENSIONS.has(named)) return named;
  return MIME_EXTENSIONS[mime] ?? "bin";
}

/** Where a stored upload is served from. Hash-addressed, so it never changes. */
export function uploadUrl(id: string) {
  return `/api/uploads/${id}`;
}

/** The stored id in an `/api/uploads/<id>` URL, or null if it is not one of ours. */
export function uploadIdFromUrl(url: string) {
  try {
    const path = url.startsWith("/") ? url.split("?")[0]! : new URL(url).pathname;
    const match = /^\/api\/uploads\/([^/]+)$/.exec(path);
    return match && isUploadId(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Every HQ upload a document still shows. Save-as-new-page and a pasted block
 * copy the URL without going through the upload endpoint, so create and save
 * have to collect these or erase will think no surviving page uses the file.
 */
export function uploadIdsInDocument(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (typeof item.url === "string") {
      const id = uploadIdFromUrl(item.url);
      if (id) found.add(id);
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found];
}

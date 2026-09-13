import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createFileRoute } from "@tanstack/react-router";
import { getUploadStore } from "@/server/uploads";

/** A year. The name of a file is the hash of its bytes, so it can never change. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const body = (path: string, start: number, end: number) =>
  Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as unknown as ReadableStream<Uint8Array>;

/** "bytes=0-1023", the one form a video element asks for. Null if unusable. */
function requestedRange(header: string | null, size: number) {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd || 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return null;
  return { start, end };
}

export const Route = createFileRoute("/api/uploads/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const found = getUploadStore().read(params.id);
        if (!found) return new Response("Not found", { status: 404 });
        const { upload, path, size } = found;
        const headers = new Headers({
          "Content-Type": upload.mime,
          "Cache-Control": CACHE_CONTROL,
          "Accept-Ranges": "bytes",
          ETag: `"${upload.id}"`,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
        });
        if (request.headers.get("if-none-match") === `"${upload.id}"`)
          return new Response(null, { status: 304, headers });

        const range = requestedRange(request.headers.get("range"), size);
        if (range) {
          headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
          headers.set("Content-Length", String(range.end - range.start + 1));
          return new Response(body(path, range.start, range.end), { status: 206, headers });
        }
        headers.set("Content-Length", String(size));
        return new Response(body(path, 0, size - 1), { headers });
      },
    },
  },
});

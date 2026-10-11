import type { ServerPlugin } from "srvx";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

/** A body this small gains too little to pay for the compressor. */
export const COMPRESS_MIN_SIZE = 1024;

/** The same speed and ratio trade-off `srvx serve --static` uses for files. */
const BROTLI_QUALITY = 4;

/** Rendered pages, JSON, and TanStack Start's framed server-function stream. */
const COMPRESSIBLE_TYPES = new Set(["text/html", "application/json", "application/x-tss-framed"]);

/** Stored files and pictures go out byte for byte, with their own ranges and tags. */
const PASSTHROUGH_PREFIXES = ["/api/uploads", "/api/avatars/"];

/** No body, or a byte range of the uncompressed body. */
const UNCOMPRESSED_STATUSES = new Set([204, 206, 304]);

type Encoding = "br" | "gzip";

/** Brotli when the client takes it, else gzip, else nothing. */
export function pickEncoding(header: string | null): Encoding | undefined {
  if (!header) return undefined;
  const quality = new Map<string, number>();
  for (const part of header.split(",")) {
    const [token = "", ...params] = part.split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    quality.set(token.trim().toLowerCase(), q ? Number.parseFloat(q.slice(2)) || 0 : 1);
  }
  const accepts = (name: Encoding) => (quality.get(name) ?? quality.get("*") ?? 0) > 0;
  return (["br", "gzip"] as const).find(accepts);
}

function isCompressible(request: Request, response: Response) {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const length = response.headers.get("content-length");
  const { pathname } = new URL(request.url);
  return (
    response.body !== null &&
    type !== undefined &&
    COMPRESSIBLE_TYPES.has(type) &&
    !UNCOMPRESSED_STATUSES.has(response.status) &&
    !response.headers.has("content-encoding") &&
    !response.headers.get("cache-control")?.includes("no-transform") &&
    !(length !== null && Number(length) < COMPRESS_MIN_SIZE) &&
    !PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * Compresses a body as it streams. Each chunk is flushed through on arrival,
 * so a server-rendered page still reaches the browser in pieces instead of
 * waiting for the last one.
 */
function compress(body: ReadableStream<Uint8Array>, encoding: Encoding) {
  const zlib =
    encoding === "br"
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
      : createGzip();
  const flushKind = encoding === "br" ? constants.BROTLI_OPERATION_FLUSH : constants.Z_SYNC_FLUSH;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zlib.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      zlib.on("error", (error) => controller.error(error));
      zlib.on("end", () => controller.close());
    },
    async pull() {
      const { done, value } = await reader.read();
      await new Promise<void>((resolve) => {
        if (done) zlib.once("end", resolve).end();
        else {
          zlib.write(value);
          zlib.flush(flushKind, resolve);
        }
      });
    },
    cancel(reason) {
      zlib.destroy();
      return reader.cancel(reason);
    },
  });
}

/**
 * Compresses rendered pages and server-function answers for clients that
 * accept brotli or gzip.
 *
 * `srvx serve --static` already compresses `dist/client` and answers before
 * any later middleware runs. This one is appended after it, so it only sees
 * what the app itself returns and never compresses a file twice. A HEAD
 * request gets the headers the GET would, without running a compressor.
 */
export const compressResponses: ServerPlugin = (server) => {
  (server.options.middleware ??= []).push(async (request, next) => {
    const response = await next();
    if (!isCompressible(request, response)) return response;

    const headers = new Headers(response.headers);
    const vary = headers.get("vary");
    if (!vary?.toLowerCase().includes("accept-encoding"))
      headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
    const init = { status: response.status, statusText: response.statusText, headers };
    const encoding = pickEncoding(request.headers.get("accept-encoding"));
    if (!encoding) return new Response(response.body, init);

    headers.set("Content-Encoding", encoding);
    headers.delete("Content-Length");
    const etag = headers.get("etag");
    if (etag?.startsWith('"')) headers.set("ETag", `W/${etag}`);
    if (request.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, init);
    }
    return new Response(compress(response.body!, encoding), init);
  });
};

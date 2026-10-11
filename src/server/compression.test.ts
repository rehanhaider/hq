import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, createBrotliDecompress, gunzipSync } from "node:zlib";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import { compressResponses, pickEncoding } from "./compression";

const PAGE = `<!doctype html><html><body>${"<p>Nasr</p>".repeat(400)}</body></html>`;
const JSON_BODY = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i })) });
const SCRIPT = `export const rows = ${JSON_BODY};\n`;

let directory: string | undefined;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

// Wired the way `srvx serve --static` wires it: the static handler first in
// the middleware list, the app's fetch behind it, the entry's plugins applied.
function server(fetch: (request: Request) => Response | Promise<Response>) {
  directory = mkdtempSync(join(tmpdir(), "hq-compress-"));
  writeFileSync(join(directory, "app.js"), SCRIPT);
  return serve({
    manual: true,
    gracefulShutdown: false,
    fetch,
    middleware: [staticMiddleware({ dir: directory })],
    plugins: [compressResponses],
  });
}

const respond =
  (body: BodyInit | null, init: ResponseInit = {}) =>
  () =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8" }, ...init });

function get(
  fetch: (request: Request) => Response | Promise<Response>,
  path = "/",
  headers: HeadersInit = { "accept-encoding": "gzip, deflate, br" },
  method = "GET",
) {
  return server(fetch).fetch(new Request(`http://hq.local${path}`, { headers, method }));
}

const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

describe("pickEncoding", () => {
  it.each([
    ["gzip, deflate, br", "br"],
    ["gzip", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["*", "br"],
    ["identity", undefined],
    [null, undefined],
  ])("%s → %s", (header, expected) => {
    expect(pickEncoding(header)).toBe(expected);
  });
});

describe("compressResponses", () => {
  it("brotli-compresses a rendered page", async () => {
    const response = await get(
      respond(PAGE, {
        headers: { "content-type": "text/html", "content-length": String(PAGE.length) },
      }),
    );
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-length")).toBeNull();
    const body = await bytes(response);
    expect(body.length).toBeLessThan(PAGE.length / 10);
    expect(brotliDecompressSync(body).toString()).toBe(PAGE);
  });

  it("falls back to gzip", async () => {
    const response = await get(respond(PAGE), "/nasr", { "accept-encoding": "gzip" });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(await bytes(response)).toString()).toBe(PAGE);
  });

  it.each(["application/json", "application/x-tss-framed; v=1"])(
    "compresses %s server-function answers",
    async (type) => {
      const response = await get(
        respond(JSON_BODY, { headers: { "content-type": type } }),
        "/_serverFn/abc",
      );
      expect(response.headers.get("content-encoding")).toBe("br");
      expect(brotliDecompressSync(await bytes(response)).toString()).toBe(JSON_BODY);
    },
  );

  it("sends the page as is, but varied, to a client that takes no compression", async () => {
    const response = await get(respond(PAGE), "/", {});
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect((await bytes(response)).toString()).toBe(PAGE);
  });

  it("answers HEAD with the GET headers and no compressor", async () => {
    const response = await get(respond(PAGE), "/", { "accept-encoding": "br" }, "HEAD");
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.body).toBeNull();
  });

  it("weakens a strong ETag on a compressed body", async () => {
    const response = await get(
      respond(PAGE, { headers: { "content-type": "text/html", etag: '"v1"' } }),
    );
    expect(response.headers.get("etag")).toBe('W/"v1"');
  });

  it.each([
    ["an upload", "/api/uploads/abc", { "content-type": "application/json" }, 200],
    ["an avatar", "/api/avatars/octo", { "content-type": "text/html" }, 200],
    ["an image", "/", { "content-type": "image/png" }, 200],
    ["a PDF", "/", { "content-type": "application/pdf" }, 200],
    [
      "an already encoded body",
      "/",
      { "content-type": "text/html", "content-encoding": "gzip" },
      200,
    ],
    ["a small body", "/", { "content-type": "text/html", "content-length": "1023" }, 200],
    ["a range", "/", { "content-type": "text/html" }, 206],
    [
      "a no-transform body",
      "/",
      { "content-type": "text/html", "cache-control": "no-transform" },
      200,
    ],
  ])("leaves %s unchanged", async (_, path, headers, status) => {
    const response = await get(respond(PAGE, { headers, status }), path);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-encoding")).toBe(
      new Headers(headers).get("content-encoding"),
    );
    expect(response.headers.get("vary")).toBeNull();
    expect((await bytes(response)).toString()).toBe(PAGE);
  });

  it.each([204, 304])("leaves a %i answer without a body", async (status) => {
    const response = await get(respond(null, { status }));
    expect(response.status).toBe(status);
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  it("does not compress a static file twice", async () => {
    const response = await get(respond(PAGE), "/app.js");
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(brotliDecompressSync(await bytes(response)).toString()).toBe(SCRIPT);
  });

  it("sends the first part of a streamed page before the rest is rendered", async () => {
    const encoder = new TextEncoder();
    let finish!: () => void;
    const rest = new Promise<void>((resolve) => (finish = resolve));
    const page = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("<!doctype html><html><head><title>HQ</title></head>"));
        await rest;
        controller.enqueue(encoder.encode(`<body>${"<p>Nasr</p>".repeat(400)}</body></html>`));
        controller.close();
      },
    });
    const response = await get(
      () => new Response(page, { headers: { "content-type": "text/html" } }),
    );
    expect(response.headers.get("content-encoding")).toBe("br");

    const reader = response.body!.getReader();
    const first = await reader.read();
    const decompress = createBrotliDecompress();
    const decoded = new Promise<string>((resolve) =>
      decompress.once("data", (chunk) => resolve(String(chunk))),
    );
    decompress.write(first.value);
    expect(await decoded).toBe("<!doctype html><html><head><title>HQ</title></head>");

    finish();
    const tail: Uint8Array[] = [first.value!];
    for (let next = await reader.read(); !next.done; next = await reader.read())
      tail.push(next.value);
    expect(brotliDecompressSync(Buffer.concat(tail)).toString()).toContain("</html>");
  });
});

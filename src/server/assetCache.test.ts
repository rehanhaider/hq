import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import { IMMUTABLE_CACHE_CONTROL, immutableAssets } from "./assetCache";

let directory: string;

afterEach(() => rmSync(directory, { recursive: true, force: true }));

// Wired the way `srvx serve --static` wires it: the static handler first in
// the middleware list, the app's fetch behind it, the entry's plugins applied.
function server() {
  directory = mkdtempSync(join(tmpdir(), "hq-assets-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "assets", "index-AbC123.js"), "export {};\n");
  writeFileSync(join(directory, "assets", "app-AbC123.css"), "body{}\n");
  writeFileSync(join(directory, "assets", "font-AbC123.woff2"), "wOF2");
  writeFileSync(join(directory, "favicon.ico"), "icon");
  return serve({
    manual: true,
    gracefulShutdown: false,
    fetch: (request) =>
      new URL(request.url).pathname === "/api/avatars/octo"
        ? new Response("png", { headers: { "content-type": "image/png" } })
        : new Response("<html></html>", {
            status: new URL(request.url).pathname.startsWith("/assets/") ? 404 : 200,
            headers: { "content-type": "text/html" },
          }),
    middleware: [staticMiddleware({ dir: directory })],
    plugins: [immutableAssets],
  });
}

const get = (path: string, headers?: HeadersInit, app = server()) =>
  app.fetch(new Request(`http://hq.local${path}`, { headers }));

describe("immutableAssets", () => {
  it.each(["index-AbC123.js", "app-AbC123.css", "font-AbC123.woff2"])(
    "caches /assets/%s for a year without revalidation",
    async (file) => {
      const response = await get(`/assets/${file}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
    },
  );

  it("keeps the header on a not-modified answer", async () => {
    const app = server();
    const first = await get("/assets/index-AbC123.js", undefined, app);
    const response = await get(
      "/assets/index-AbC123.js",
      { "if-none-match": first.headers.get("etag")! },
      app,
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("leaves a missing asset uncached", async () => {
    const response = await get("/assets/index-Gone99.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it.each(["/", "/nasr", "/api/avatars/octo", "/favicon.ico"])(
    "leaves %s as it was",
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBeNull();
    },
  );
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AvatarStore, avatarMime, isAvatarOrg } from "./avatars";

// A one-pixel PNG, so the bytes are a real file rather than a string.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

let directory: string;
const stores: AvatarStore[] = [];

function avatars(ttlMs?: number) {
  directory = mkdtempSync(join(tmpdir(), "hq-avatars-"));
  const store = new AvatarStore(directory, ttlMs);
  stores.push(store);
  return store;
}

function fetchOk(bytes: Uint8Array = png, contentType = "image/png") {
  const copy = Uint8Array.from(bytes);
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(copy, { headers: { "content-type": contentType } }),
  );
}

/** The image downloads: everything but the HEAD requests that resolve it. */
function gets(fetch: ReturnType<typeof fetchOk>) {
  return fetch.mock.calls.filter(([, init]) => init?.method !== "HEAD");
}

afterEach(() => {
  vi.unstubAllGlobals();
  stores.length = 0;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined!;
});

describe("avatar org validation", () => {
  it.each(["Mizanic", "Magnolia-Impact", "a", "x".repeat(39)])(
    "accepts the login %s",
    (org) => expect(isAvatarOrg(org)).toBe(true),
  );
  it.each(["", "-org", "org-", "or g", "org/repo", "..", ".", "x".repeat(40), null, 42])(
    "refuses %s",
    (org) => expect(isAvatarOrg(org)).toBe(false),
  );
});

describe("avatar mime sniffing", () => {
  it("reads the kind from the bytes, not the fetch", () => {
    expect(avatarMime(png)).toBe("image/png");
    expect(avatarMime(jpeg)).toBe("image/jpeg");
    expect(avatarMime(Buffer.from("not an image"))).toBe(null);
  });
});

describe("avatar store", () => {
  it("fetches once, then serves the file without fetching again", async () => {
    const fetch = fetchOk();
    vi.stubGlobal("fetch", fetch);
    const store = avatars();
    const first = await store.read("Mizanic");
    expect(first?.mime).toBe("image/png");
    expect(first?.bytes).toEqual(png);
    // Resolving the shortcut answers the HEAD with the picture itself, so
    // the one download goes to the shortcut address.
    expect(gets(fetch).map(([url]) => url)).toEqual([
      "https://github.com/mizanic.png",
    ]);

    const second = await store.read("Mizanic");
    expect(second?.bytes).toEqual(png);
    expect(fetch).toHaveBeenCalledTimes(2);
    // The write lands atomically: the org file, and no staging file beside it.
    expect(readdirSync(directory)).toEqual(["mizanic"]);
  });

  it("lowercases the login, so case never fetches twice", async () => {
    const fetch = fetchOk();
    vi.stubGlobal("fetch", fetch);
    const store = avatars();
    await store.read("Mizanic");
    await store.read("MIZANIC");
    expect(gets(fetch)).toHaveLength(1);
  });

  it("refreshes a file older than the TTL", async () => {
    vi.stubGlobal("fetch", fetchOk(jpeg, "image/jpeg"));
    const store = avatars(-1);
    writeFileSync(join(directory, "mizanic"), png);
    const result = await store.read("Mizanic");
    expect(result?.mime).toBe("image/jpeg");
    expect(result?.bytes).toEqual(jpeg);
  });

  it("serves the stale file when the refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    const store = avatars(-1);
    writeFileSync(join(directory, "mizanic"), png);
    const result = await store.read("Mizanic");
    expect(result?.bytes).toEqual(png);
  });

  it("returns null when there is nothing cached and the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(avatars().read("Mizanic")).resolves.toBe(null);
  });

  it("refuses a login it must never turn into a path", async () => {
    const fetch = fetchOk();
    vi.stubGlobal("fetch", fetch);
    await expect(avatars().read("../escape")).resolves.toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses bytes that are not an image", async () => {
    vi.stubGlobal("fetch", fetchOk(Buffer.from("not an image"), "image/png"));
    await expect(avatars().read("Mizanic")).resolves.toBe(null);
  });

  it("shares one flight between concurrent readers", async () => {
    const fetch = fetchOk();
    vi.stubGlobal("fetch", fetch);
    const store = avatars();
    const [a, b] = await Promise.all([store.read("Mizanic"), store.read("Mizanic")]);
    expect(a?.bytes).toEqual(png);
    expect(b?.bytes).toEqual(png);
    expect(gets(fetch)).toHaveLength(1);
  });

  it("ignores a cached file that is not an image", async () => {
    const store = avatars(-1);
    writeFileSync(join(directory, "mizanic"), Buffer.from("not an image"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(store.read("Mizanic")).resolves.toBe(null);
  });

  it("resolves the shortcut with HEAD, then downloads the sized picture once", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        if (url.startsWith("https://github.com/"))
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://avatars.githubusercontent.com/u/123?v=4",
            },
          });
        return new Response(null, { status: 200 });
      }
      return new Response(Uint8Array.from(png), {
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await avatars().read("Mizanic");
    expect(result?.bytes).toEqual(png);
    expect(gets(fetch).map(([url]) => url)).toEqual([
      "https://avatars.githubusercontent.com/u/123?v=4&s=96",
    ]);
  });

  it("keeps a CDN address that already sizes instead of resizing it", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        if (url.startsWith("https://github.com/"))
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://avatars.githubusercontent.com/u/123?s=96",
            },
          });
        return new Response(null, { status: 200 });
      }
      return new Response(Uint8Array.from(png), {
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await avatars().read("Mizanic");
    expect(result?.bytes).toEqual(png);
    expect(gets(fetch).map(([url]) => url)).toEqual([
      "https://avatars.githubusercontent.com/u/123?s=96",
    ]);
  });
});

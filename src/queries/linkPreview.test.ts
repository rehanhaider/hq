import { describe, expect, it } from "vitest";
import { linkPreviewKeys, linkPreviewQuery } from "./linkPreview";
import { writeLinkPreviewCache, type LinkPreviewData } from "@/lib/linkPreview";

const URL_ = "https://example.com/post";

const DATA: LinkPreviewData = {
  url: URL_,
  title: "A post",
  description: "About things",
  siteName: "Example",
  image: null,
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("linkPreviewKeys", () => {
  it("keys previews by url", () => {
    expect(linkPreviewKeys.url(URL_)).toEqual(["link-preview", URL_]);
  });
});

describe("linkPreviewQuery", () => {
  it("stays disabled without a url, never retries, and caches for a day", () => {
    expect(linkPreviewQuery("").enabled).toBe(false);
    const active = linkPreviewQuery(URL_, async () => DATA);
    expect(active.enabled).toBe(true);
    expect(active.retry).toBe(false);
    expect(active.staleTime).toBe(24 * 60 * 60 * 1000);
    expect(active.gcTime).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("fetches through the server fn with the url and stores the result", async () => {
    const calls: unknown[] = [];
    const storage = memoryStorage();
    const options = linkPreviewQuery(
      URL_,
      (async (args: unknown) => {
        calls.push(args);
        return DATA;
      }) as never,
      storage,
    );
    await (options.queryFn as () => Promise<LinkPreviewData>)();
    expect(calls).toEqual([{ data: { url: URL_ } }]);
    expect(options.initialData).toBeUndefined();
    const stored = linkPreviewQuery(URL_, async () => DATA, storage);
    expect(stored.initialData).toEqual(DATA);
  });

  it("seeds React Query from localStorage so a refresh has data on the first paint", () => {
    const storage = memoryStorage();
    const before = Date.now();
    writeLinkPreviewCache(storage, URL_, DATA);
    const options = linkPreviewQuery(URL_, async () => DATA, storage);
    expect(options.initialData).toEqual(DATA);
    expect(options.initialDataUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(options.initialDataUpdatedAt).toBeLessThanOrEqual(Date.now());
    const placeholder = options.placeholderData as (
      previous: LinkPreviewData | undefined,
    ) => LinkPreviewData | undefined;
    expect(placeholder({ ...DATA, title: "live" })?.title).toBe("live");
    expect(placeholder(undefined)).toBeUndefined();
  });
});

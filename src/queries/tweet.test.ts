import { describe, expect, it } from "vitest";
import { tweetEmbedQuery, tweetKeys } from "./tweet";
import { writeTweetEmbedCache } from "@/lib/tweetEmbed";
import type { TweetEmbedData } from "@/lib/tweetEmbed";

const DATA: TweetEmbedData = {
  id: "20",
  name: "jack",
  handle: "jack",
  avatar: "https://pbs.twimg.com/profile_images/1/jack_normal.jpg",
  verified: false,
  createdAt: "2006-03-21T20:50:14.000Z",
  text: "just setting up my twttr",
  segments: [{ type: "text", text: "just setting up my twttr" }],
  photos: [],
  video: null,
  likes: 129000,
  replies: 180000,
  permalink: "https://x.com/jack/status/20",
  quote: null,
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

describe("tweetKeys", () => {
  it("keys embeds by id and theme", () => {
    expect(tweetKeys.embed("20", "dark")).toEqual([
      "tweet",
      "embed",
      "20",
      "dark",
    ]);
    expect(tweetKeys.embed("20", "dark")).not.toEqual(
      tweetKeys.embed("20", "light"),
    );
  });
});

describe("tweetEmbedQuery", () => {
  it("stays disabled without an id and caches tweets for weeks", () => {
    expect(tweetEmbedQuery("", "dark").enabled).toBe(false);
    const active = tweetEmbedQuery("20", "dark", async () => DATA);
    expect(active.enabled).toBe(true);
    expect(active.staleTime).toBe(7 * 24 * 60 * 60 * 1000);
    expect(active.gcTime).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("fetches through the server fn with id and theme and stores the result", async () => {
    const calls: unknown[] = [];
    const storage = memoryStorage();
    const options = tweetEmbedQuery(
      "20",
      "dark",
      (async (args: unknown) => {
        calls.push(args);
        return DATA;
      }) as never,
      storage,
    );
    await (options.queryFn as () => Promise<TweetEmbedData>)();
    expect(calls).toEqual([{ data: { id: "20", theme: "dark" } }]);
    expect(options.initialData).toBeUndefined();
    const stored = tweetEmbedQuery("20", "dark", async () => DATA, storage);
    expect(stored.initialData).toEqual(DATA);
  });

  it("seeds React Query from localStorage so a refresh has data on the first paint", () => {
    const storage = memoryStorage();
    const before = Date.now();
    writeTweetEmbedCache(storage, "20", "dark", DATA);
    const options = tweetEmbedQuery("20", "dark", async () => DATA, storage);
    expect(options.initialData).toEqual(DATA);
    expect(options.initialDataUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(options.initialDataUpdatedAt).toBeLessThanOrEqual(Date.now());
    const placeholder = options.placeholderData as (
      previous: TweetEmbedData | undefined,
    ) => TweetEmbedData | undefined;
    expect(placeholder({ ...DATA, name: "live" })?.name).toBe("live");
    expect(placeholder(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  fetchTweetOembed,
  readTweetEmbedCache,
  readTweetEmbedCacheEntry,
  sanitizeOembedHtml,
  tweetEmbedCacheKey,
  tweetOembedUrl,
  writeTweetEmbedCache,
  TWEET_EMBED_CACHE_TTL_MS,
  type TweetEmbedCacheStorage,
  type TweetEmbedData,
} from "./tweetEmbed";

const ID = "20";
const DATA: TweetEmbedData = {
  id: ID,
  html: '<blockquote class="twitter-tweet"><p lang="en">just setting up my twttr</p></blockquote>',
  authorName: "jack",
  authorUrl: "https://x.com/jack",
};

function memoryStorage(
  initial: Record<string, string> = {},
): TweetEmbedCacheStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    dump: () => Object.fromEntries(map),
  };
}

describe("tweetOembedUrl", () => {
  it("points at X with the canonical URL, theme, no script, and no parent thread", () => {
    const parsed = new URL(tweetOembedUrl(ID, "dark"));
    expect(parsed.origin + parsed.pathname).toBe("https://publish.x.com/oembed");
    expect(parsed.searchParams.get("url")).toBe(
      `https://x.com/i/status/${ID}`,
    );
    expect(parsed.searchParams.get("theme")).toBe("dark");
    expect(parsed.searchParams.get("omit_script")).toBe("true");
    expect(parsed.searchParams.get("dnt")).toBe("true");
    expect(parsed.searchParams.get("hide_thread")).toBe("true");
  });
});

describe("sanitizeOembedHtml", () => {
  it("strips scripts and keeps genuine tweet markup", () => {
    expect(
      sanitizeOembedHtml(
        `${DATA.html}<script async src="https://platform.x.com/widgets.js"></script>`,
      ),
    ).toBe(DATA.html);
  });

  it("rejects non-tweet markup, non-strings, and absurd payloads", () => {
    expect(sanitizeOembedHtml('<div class="tweet">hi</div>')).toBeNull();
    expect(sanitizeOembedHtml(undefined)).toBeNull();
    expect(sanitizeOembedHtml("")).toBeNull();
    expect(
      sanitizeOembedHtml(`<blockquote class="twitter-tweet">${"x".repeat(25_000)}</blockquote>`),
    ).toBeNull();
  });
});

describe("fetchTweetOembed", () => {
  function stubFetch(body: unknown, ok = true) {
    return (async (_url: unknown, init?: { signal?: unknown }) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok, json: async () => body };
    }) as unknown as typeof fetch;
  }

  it("maps the oEmbed fields", async () => {
    const data = await fetchTweetOembed(ID, "dark", stubFetch({
      html: DATA.html,
      author_name: "jack",
      author_url: "https://x.com/jack",
    }));
    expect(data).toEqual(DATA);
  });

  it("throws one error for bad statuses and bad payloads", async () => {
    await expect(fetchTweetOembed(ID, "dark", stubFetch({}, false))).rejects.toThrow(
      "Could not load tweet.",
    );
    await expect(
      fetchTweetOembed(ID, "dark", stubFetch({ html: "<div>nope</div>" })),
    ).rejects.toThrow("Could not load tweet.");
    await expect(
      fetchTweetOembed(ID, "dark", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("Could not load tweet.");
  });
});

describe("tweet embed cache", () => {
  it("round-trips under a per-theme key", () => {
    const storage = memoryStorage();
    const before = Date.now();
    writeTweetEmbedCache(storage, ID, "dark", DATA);
    expect(readTweetEmbedCache(storage, ID, "dark")).toEqual(DATA);
    const entry = readTweetEmbedCacheEntry(storage, ID, "dark");
    expect(entry?.savedAt).toBeGreaterThanOrEqual(before);
    expect(entry?.savedAt).toBeLessThanOrEqual(Date.now());
    expect(readTweetEmbedCache(storage, ID, "light")).toBeUndefined();
    expect(tweetEmbedCacheKey(ID, "dark")).not.toBe(
      tweetEmbedCacheKey(ID, "light"),
    );
  });

  it("drops expired entries and corrupt JSON", () => {
    const storage = memoryStorage();
    writeTweetEmbedCache(storage, ID, "dark", DATA);
    const key = tweetEmbedCacheKey(ID, "dark");
    expect(
      readTweetEmbedCache(storage, ID, "dark", Date.now() + TWEET_EMBED_CACHE_TTL_MS + 1),
    ).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
    const corrupt = memoryStorage({ [key]: "not json{" });
    expect(readTweetEmbedCache(corrupt, ID, "dark")).toBeUndefined();
  });

  it("prunes old tweets once when the quota is full", () => {
    const storage = memoryStorage();
    writeTweetEmbedCache(storage, "old", "dark", { ...DATA, id: "old" });
    storage.setItem("hq:unrelated", "keep");
    let failNext = true;
    const flaky: TweetEmbedCacheStorage = {
      ...storage,
      setItem: (key, value) => {
        if (failNext) {
          failNext = false;
          throw new Error("QuotaExceededError");
        }
        storage.setItem(key, value);
      },
    };
    writeTweetEmbedCache(flaky, ID, "dark", DATA);
    expect(readTweetEmbedCache(storage, ID, "dark")).toEqual(DATA);
    expect(storage.getItem("hq:unrelated")).toBe("keep");
  });
});

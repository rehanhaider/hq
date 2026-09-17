import { describe, expect, it } from "vitest";
import {
  fetchTweetData,
  normalizeTweet,
  parseTweetEmbedData,
  readTweetEmbedCache,
  readTweetEmbedCacheEntry,
  tweetEmbedCacheKey,
  tweetSegments,
  tweetSyndicationToken,
  tweetSyndicationUrl,
  writeTweetEmbedCache,
  TWEET_EMBED_CACHE_TTL_MS,
  type TweetEmbedCacheStorage,
  type TweetEmbedData,
} from "./tweetEmbed";

const ID = "440322224407314432";

/** Trimmed from a real `cdn.syndication.twimg.com/tweet-result` response. */
const PAYLOAD = {
  id_str: ID,
  created_at: "2014-03-03T03:06:13.000Z",
  display_text_range: [0, 81],
  favorite_count: 1863282,
  conversation_count: 158869,
  text: "If only Bradley's arm was longer. Best photo ever. #oscars http://t.co/C9U5NOtGap",
  entities: {
    hashtags: [{ indices: [51, 58], text: "oscars" }],
    media: [
      {
        display_url: "pic.x.com/C9U5NOtGap",
        expanded_url: `https://x.com/TheEllenShow/status/${ID}/photo/1`,
        indices: [59, 81],
        url: "http://t.co/C9U5NOtGap",
      },
    ],
  },
  user: {
    name: "The Ellen Show",
    screen_name: "TheEllenShow",
    is_blue_verified: true,
    profile_image_url_https:
      "https://pbs.twimg.com/profile_images/1909090851592273920/UutmZxGI_normal.jpg",
  },
  photos: [
    {
      url: "https://pbs.twimg.com/media/BhxWutnCEAAtEQ6.jpg",
      width: 1920,
      height: 1080,
    },
  ],
  mediaDetails: [
    {
      type: "photo",
      url: "https://pbs.twimg.com/media/BhxWutnCEAAtEQ6.jpg",
      ext_alt_text: "A crowded selfie.",
    },
  ],
};

const DATA = normalizeTweet(PAYLOAD, ID) as TweetEmbedData;

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

describe("tweetSyndicationUrl", () => {
  it("carries the id, the id-derived token, and a language", () => {
    const parsed = new URL(tweetSyndicationUrl(ID));
    expect(parsed.origin + parsed.pathname).toBe(
      "https://cdn.syndication.twimg.com/tweet-result",
    );
    expect(parsed.searchParams.get("id")).toBe(ID);
    expect(parsed.searchParams.get("token")).toBe(tweetSyndicationToken(ID));
    expect(parsed.searchParams.get("lang")).toBe("en");
    expect(tweetSyndicationToken(ID)).toMatch(/^[0-9a-z]+$/);
    expect(tweetSyndicationToken("1683920951807971329")).toBe("42y6zv7ufp");
  });
});

describe("normalizeTweet", () => {
  it("maps the author, the counts, and the permalink", () => {
    expect(DATA.id).toBe(ID);
    expect(DATA.name).toBe("The Ellen Show");
    expect(DATA.handle).toBe("TheEllenShow");
    expect(DATA.verified).toBe(true);
    expect(DATA.avatar).toBe(PAYLOAD.user.profile_image_url_https);
    expect(DATA.createdAt).toBe("2014-03-03T03:06:13.000Z");
    expect(DATA.likes).toBe(1863282);
    expect(DATA.replies).toBe(158869);
    expect(DATA.permalink).toBe(
      `https://x.com/TheEllenShow/status/${ID}`,
    );
    expect(DATA.quote).toBeNull();
    expect(DATA.video).toBeNull();
  });

  it("drops the trailing media link and keeps the hashtag as a link", () => {
    expect(DATA.text).toBe("If only Bradley's arm was longer. Best photo ever. #oscars");
    expect(DATA.segments).toEqual([
      { type: "text", text: "If only Bradley's arm was longer. Best photo ever. " },
      { type: "hashtag", text: "#oscars", href: "https://x.com/hashtag/oscars" },
    ]);
  });

  it("keeps photo dimensions and alt text so the card reserves its space", () => {
    expect(DATA.photos).toEqual([
      {
        url: "https://pbs.twimg.com/media/BhxWutnCEAAtEQ6.jpg",
        width: 1920,
        height: 1080,
        alt: "A crowded selfie.",
      },
    ]);
  });

  it("takes the highest-bitrate mp4 and the aspect ratio for video", () => {
    const withVideo = normalizeTweet(
      {
        ...PAYLOAD,
        photos: [],
        video: {
          poster: "https://pbs.twimg.com/ext_tw_video_thumb/1/img.jpg",
          aspectRatio: [16, 9],
          variants: [
            { type: "application/x-mpegURL", src: "https://video.twimg.com/a.m3u8" },
            { type: "video/mp4", src: "https://video.twimg.com/low.mp4", bitrate: 632000 },
            { type: "video/mp4", src: "https://video.twimg.com/high.mp4", bitrate: 2176000 },
          ],
        },
      },
      ID,
    );
    expect(withVideo?.video).toEqual({
      poster: "https://pbs.twimg.com/ext_tw_video_thumb/1/img.jpg",
      src: "https://video.twimg.com/high.mp4",
      width: 16,
      height: 9,
    });
  });

  it("summarizes a quoted tweet", () => {
    const quoting = normalizeTweet(
      {
        ...PAYLOAD,
        quoted_tweet: {
          id_str: "20",
          text: "just setting up my twttr",
          display_text_range: [0, 24],
          user: { name: "jack", screen_name: "jack" },
        },
      },
      ID,
    );
    expect(quoting?.quote).toEqual({
      name: "jack",
      handle: "jack",
      text: "just setting up my twttr",
      permalink: "https://x.com/jack/status/20",
      photos: [],
    });
  });

  it("keeps a quoted tweet's photo so the card shows the whole quote", () => {
    const quoting = normalizeTweet(
      {
        ...PAYLOAD,
        quoted_tweet: {
          id_str: "21",
          text: "chart",
          display_text_range: [0, 5],
          user: { name: "ed", screen_name: "ed" },
          photos: [
            {
              url: "https://pbs.twimg.com/media/HSGIOvubwAAhS4-.jpg",
              width: 800,
              height: 668,
            },
          ],
        },
      },
      ID,
    );
    expect(quoting?.quote?.photos).toEqual([
      {
        url: "https://pbs.twimg.com/media/HSGIOvubwAAhS4-.jpg",
        width: 800,
        height: 668,
        alt: "",
      },
    ]);
  });

  it("refuses media and links from anywhere but X", () => {
    const hostile = normalizeTweet(
      {
        ...PAYLOAD,
        entities: {
          urls: [
            {
              indices: [0, 7],
              display_url: "evil",
              expanded_url: "javascript:alert(1)",
            },
          ],
        },
        user: {
          ...PAYLOAD.user,
          profile_image_url_https: "https://evil.example/avatar.jpg",
        },
        photos: [{ url: "https://evil.example/x.jpg", width: 10, height: 10 }],
      },
      ID,
    );
    expect(hostile?.avatar).toBe("");
    expect(hostile?.photos).toEqual([]);
    expect(
      hostile?.segments.some((segment) => segment.href?.startsWith("javascript")),
    ).toBe(false);
  });

  it("rejects a payload with no author", () => {
    expect(normalizeTweet({ ...PAYLOAD, user: {} }, ID)).toBeNull();
    expect(normalizeTweet(null, ID)).toBeNull();
  });
});

describe("tweetSegments", () => {
  it("counts entity indices in code points, not UTF-16 units", () => {
    // The emoji is two UTF-16 units, so a plain slice would cut the link.
    expect(
      tweetSegments("🚀 hi @jack", [0, 10], {
        user_mentions: [{ indices: [5, 10], screen_name: "jack" }],
      }),
    ).toEqual([
      { type: "text", text: "🚀 hi " },
      { type: "mention", text: "@jack", href: "https://x.com/jack" },
    ]);
  });

  it("honours display_text_range and trims the edges", () => {
    expect(tweetSegments("@who look at this  ", [5, 17], {})).toEqual([
      { type: "text", text: "look at this" },
    ]);
  });
});

describe("tweet cache", () => {
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

  it("ignores the v1 oEmbed and v2 photo-less entries this replaced", () => {
    const legacy = memoryStorage({
      [`hq:tweet-embed:v1:dark:${ID}`]: JSON.stringify({
        html: '<blockquote class="twitter-tweet"><p>old</p></blockquote>',
        savedAt: Date.now(),
      }),
      [`hq:tweet-embed:v2:dark:${ID}`]: JSON.stringify({
        savedAt: Date.now(),
        data: { ...DATA, quote: { ...DATA.quote, photos: undefined } },
      }),
    });
    expect(tweetEmbedCacheKey(ID, "dark")).toContain("v3");
    expect(readTweetEmbedCache(legacy, ID, "dark")).toBeUndefined();
  });

  it("drops expired entries, corrupt JSON, and tampered media", () => {
    const storage = memoryStorage();
    writeTweetEmbedCache(storage, ID, "dark", DATA);
    const key = tweetEmbedCacheKey(ID, "dark");
    expect(
      readTweetEmbedCache(storage, ID, "dark", Date.now() + TWEET_EMBED_CACHE_TTL_MS + 1),
    ).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
    const corrupt = memoryStorage({ [key]: "not json{" });
    expect(readTweetEmbedCache(corrupt, ID, "dark")).toBeUndefined();
    const tampered = memoryStorage({
      [key]: JSON.stringify({
        savedAt: Date.now(),
        data: {
          ...DATA,
          photos: [{ url: "https://evil.example/x.jpg", width: 1, height: 1, alt: "" }],
        },
      }),
    });
    expect(readTweetEmbedCache(tampered, ID, "dark")?.photos).toEqual([]);
  });

  it("prunes old tweets, v1 included, once when the quota is full", () => {
    const storage = memoryStorage();
    writeTweetEmbedCache(storage, "20", "dark", { ...DATA, id: "20" });
    storage.setItem(`hq:tweet-embed:v1:dark:${ID}`, "{}");
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
    expect(storage.getItem(`hq:tweet-embed:v1:dark:${ID}`)).toBeNull();
    expect(storage.getItem("hq:unrelated")).toBe("keep");
  });
});

describe("parseTweetEmbedData", () => {
  it("returns undefined without an author or segments", () => {
    expect(parseTweetEmbedData({ segments: [] }, ID)).toBeUndefined();
    expect(parseTweetEmbedData({ handle: "jack" }, ID)).toBeUndefined();
  });
});

describe("fetchTweetData", () => {
  function stubFetch(body: unknown, ok = true) {
    return (async (url: unknown, init?: { signal?: unknown }) => {
      expect(String(url)).toContain("cdn.syndication.twimg.com");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok, json: async () => body };
    }) as unknown as typeof fetch;
  }

  it("normalizes the syndication payload", async () => {
    expect(await fetchTweetData(ID, stubFetch(PAYLOAD))).toEqual(DATA);
  });

  it("throws one error for bad statuses, bad payloads, and no network", async () => {
    await expect(fetchTweetData(ID, stubFetch({}, false))).rejects.toThrow(
      "Could not load tweet.",
    );
    await expect(fetchTweetData(ID, stubFetch({ user: {} }))).rejects.toThrow(
      "Could not load tweet.",
    );
    await expect(
      fetchTweetData(ID, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("Could not load tweet.");
  });
});

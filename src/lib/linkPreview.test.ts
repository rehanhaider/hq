import { describe, expect, it } from "vitest";
import {
  LINK_PREVIEW_CACHE_TTL_MS,
  bookmarkUrlsFromDocument,
  decodeHtmlEntities,
  linkPreviewCacheKey,
  linkPreviewFrom,
  linkPreviewUrl,
  normalizeOEmbed,
  parseLinkPage,
  parseLinkPreviewData,
  readLinkPreviewCacheEntry,
  writeLinkPreviewCache,
  type LinkPreviewData,
} from "./linkPreview";

const URL_ = "https://example.com/post";

const PREVIEW: LinkPreviewData = {
  url: URL_,
  title: "A post",
  description: "About things",
  siteName: "Example",
  image: { url: "https://example.com/og.png", width: 1200, height: 630 },
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
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
  };
}

describe("linkPreviewUrl", () => {
  it("accepts http and https, trims, and drops the fragment", () => {
    expect(linkPreviewUrl("  https://example.com/a?b=1#top ")).toBe(
      "https://example.com/a?b=1",
    );
    expect(linkPreviewUrl("http://example.com")).toBe("http://example.com/");
  });

  it("refuses other schemes, credentials, and junk", () => {
    expect(linkPreviewUrl("ftp://example.com/file")).toBeNull();
    expect(linkPreviewUrl("javascript:alert(1)")).toBeNull();
    expect(linkPreviewUrl("https://user:pw@example.com/")).toBeNull();
    expect(linkPreviewUrl("example.com")).toBeNull();
    expect(linkPreviewUrl("")).toBeNull();
    expect(linkPreviewUrl(`https://example.com/${"a".repeat(2_100)}`)).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named, decimal, and hex entities and leaves unknown ones", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &#39;s &#x2014; &hellip; &bogus;")).toBe(
      "Tom & Jerry 's — … &bogus;",
    );
  });
});

describe("parseLinkPage", () => {
  it("prefers Open Graph, then Twitter, then the document title and description", () => {
    const html = `<!doctype html><html><head>
      <title>Doc &amp; title</title>
      <meta name="description" content="Doc description">
      <meta property="og:title" content="OG title">
      <meta name="twitter:description" content="Twitter description">
      <meta property="og:site_name" content="Example">
      <meta property="og:image" content="/og.png">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <link rel="alternate" type="application/json+oembed" href="/oembed?url=x">
    </head><body><p>hello</p></body></html>`;
    expect(parseLinkPage(html, "https://example.com/post")).toEqual({
      title: "OG title",
      description: "Twitter description",
      siteName: "Example",
      image: { url: "https://example.com/og.png", width: 1200, height: 630 },
      oembedUrl: "https://example.com/oembed?url=x",
    });
  });

  it("falls back to the title tag, ignores http images, and survives odd markup", () => {
    const html = `<html><head>
      <meta content="Attr order swapped" property="og:description" />
      <META NAME='og:image' CONTENT='http://example.com/plain.png'>
      <title>
        Just &lt;a&gt; title
      </title>
      <script>document.write("<meta property='og:title' content='injected'>")</script>
    </head></html>`;
    expect(parseLinkPage(html, "https://example.com/")).toEqual({
      title: "Just <a> title",
      description: "Attr order swapped",
      siteName: "",
      image: null,
      oembedUrl: null,
    });
  });

  it("reads the first tag of a name, caps lengths, and collapses whitespace", () => {
    const html = `<head>
      <meta property="og:title" content="  First\n\n   title ">
      <meta property="og:title" content="Second">
      <meta property="og:description" content="${"x".repeat(900)}">
    </head>`;
    const page = parseLinkPage(html, "https://example.com/");
    expect(page.title).toBe("First title");
    expect(page.description).toHaveLength(500);
  });

  it("returns nothing for a page with no tags", () => {
    expect(parseLinkPage("<html><body>bare</body></html>", "https://example.com/")).toEqual({
      title: "",
      description: "",
      siteName: "",
      image: null,
      oembedUrl: null,
    });
  });
});

describe("normalizeOEmbed", () => {
  it("keeps title, provider, author, and an https thumbnail, never html", () => {
    expect(
      normalizeOEmbed({
        type: "video",
        title: "A video",
        provider_name: "Vid",
        author_name: "Alice",
        thumbnail_url: "https://cdn.example.com/t.jpg",
        thumbnail_width: "480",
        thumbnail_height: 360,
        html: "<iframe src='https://evil.example'></iframe>",
      }),
    ).toEqual({
      title: "A video",
      providerName: "Vid",
      authorName: "Alice",
      thumbnail: { url: "https://cdn.example.com/t.jpg", width: 480, height: 360 },
    });
  });

  it("returns null for an empty or non-object payload", () => {
    expect(normalizeOEmbed(null)).toBeNull();
    expect(normalizeOEmbed("<html>")).toBeNull();
    expect(normalizeOEmbed({ html: "<b>only</b>" })).toBeNull();
    expect(normalizeOEmbed({ thumbnail_url: "http://insecure.example/t.jpg" })).toBeNull();
  });
});

describe("linkPreviewFrom", () => {
  const empty = { title: "", description: "", siteName: "", image: null, oembedUrl: null };

  it("merges page tags with oEmbed, page first", () => {
    expect(
      linkPreviewFrom(
        URL_,
        { ...empty, title: "Page title" },
        {
          title: "oEmbed title",
          providerName: "Provider",
          authorName: "Alice",
          thumbnail: { url: "https://cdn.example.com/t.jpg", width: 0, height: 0 },
        },
      ),
    ).toEqual({
      url: URL_,
      title: "Page title",
      description: "By Alice",
      siteName: "Provider",
      image: { url: "https://cdn.example.com/t.jpg", width: 0, height: 0 },
    });
  });

  it("has nothing to draw without a title from any source", () => {
    expect(linkPreviewFrom(URL_, { ...empty, description: "only" }, null)).toBeNull();
    expect(
      linkPreviewFrom(URL_, empty, {
        title: "",
        providerName: "P",
        authorName: "",
        thumbnail: null,
      }),
    ).toBeNull();
  });
});

describe("parseLinkPreviewData", () => {
  it("re-validates a stored entry and drops an unsafe image or link", () => {
    expect(
      parseLinkPreviewData(
        {
          ...PREVIEW,
          url: "javascript:alert(1)",
          image: { url: "http://example.com/og.png", width: 10, height: 10 },
        },
        URL_,
      ),
    ).toEqual({ ...PREVIEW, url: URL_, image: null });
    expect(parseLinkPreviewData({ ...PREVIEW, title: "" }, URL_)).toBeUndefined();
    expect(parseLinkPreviewData("nope", URL_)).toBeUndefined();
  });
});

describe("link preview cache", () => {
  it("round-trips through storage and expires after the TTL", () => {
    const storage = memoryStorage();
    writeLinkPreviewCache(storage, URL_, PREVIEW);
    expect(storage.getItem(linkPreviewCacheKey(URL_))).toContain('"savedAt"');
    const entry = readLinkPreviewCacheEntry(storage, URL_);
    expect(entry?.data).toEqual(PREVIEW);
    expect(
      readLinkPreviewCacheEntry(storage, URL_, Date.now() + LINK_PREVIEW_CACHE_TTL_MS + 1),
    ).toBeUndefined();
    expect(storage.getItem(linkPreviewCacheKey(URL_))).toBeNull();
  });

  it("tolerates a missing storage, bad JSON, and a full quota", () => {
    expect(readLinkPreviewCacheEntry(undefined, URL_)).toBeUndefined();
    writeLinkPreviewCache(undefined, URL_, PREVIEW);
    const storage = memoryStorage();
    storage.setItem(linkPreviewCacheKey(URL_), "{not json");
    expect(readLinkPreviewCacheEntry(storage, URL_)).toBeUndefined();

    let writes = 0;
    const full = {
      ...memoryStorage(),
      setItem: () => {
        writes += 1;
        throw new Error("QuotaExceededError");
      },
    };
    writeLinkPreviewCache(full, URL_, PREVIEW);
    expect(writes).toBe(2);
  });
});

describe("bookmarkUrlsFromDocument", () => {
  it("collects unique bookmark URLs in document order, including nested blocks", () => {
    expect(
      bookmarkUrlsFromDocument([
        {
          type: "bookmark",
          props: { url: "https://example.com/a" },
          children: [{ type: "bookmark", props: { url: "https://example.org/b#x" } }],
        },
        { type: "tweet", props: { url: "https://x.com/alice/status/20" }, children: [] },
        { type: "bookmark", props: { url: "https://example.com/a" } },
        { type: "bookmark", props: { url: "not a url" } },
      ]),
    ).toEqual(["https://example.com/a", "https://example.org/b"]);
    expect(bookmarkUrlsFromDocument(undefined)).toEqual([]);
  });
});

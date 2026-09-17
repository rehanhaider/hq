/**
 * Link preview data for a bookmark block. A pasted URL on its own line
 * becomes a card drawn from the page's Open Graph tags, its oEmbed
 * endpoint, or failing both its `<title>`. The server fetches the page —
 * the browser could not, for CORS — and reduces it to the small JSON
 * shape below. React Query keeps it in memory and localStorage carries it
 * across refreshes, the same path the tweet card uses.
 */

export interface LinkPreviewImage {
  url: string;
  /** Zero when the page did not say. */
  width: number;
  height: number;
}

export interface LinkPreviewData {
  /** The URL the card links to: the pasted one, after redirects. */
  url: string;
  title: string;
  description: string;
  siteName: string;
  image: LinkPreviewImage | null;
}

export const LINK_TITLE_LIMIT = 300;
export const LINK_DESCRIPTION_LIMIT = 500;
const SITE_NAME_LIMIT = 100;
const URL_LIMIT = 2_048;

/** A week: pages change, and a stale card still links to the right place. */
export const LINK_PREVIEW_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_NAMESPACE = "hq:link-preview:";
const CACHE_PREFIX = `${CACHE_NAMESPACE}v1`;

/**
 * An http(s) URL the server may fetch and the card may link to. Credentials
 * in the URL and other schemes are refused; the hash is dropped because it
 * never reaches the server anyway.
 */
export function linkPreviewUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > URL_LIMIT) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || !parsed.hostname) return null;
  parsed.hash = "";
  return parsed.toString();
}

/** Card images go into `src`, so only https survives; http would be mixed content. */
function imageUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || value.length > URL_LIMIT) return null;
  let parsed: URL;
  try {
    parsed = base ? new URL(value.trim(), base) : new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

function text(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function dimension(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.min(Math.round(number), 10_000)
    : 0;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]+));/gi,
    (match, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
      const code = hex ? parseInt(hex, 16) : decimal ? Number(decimal) : NaN;
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const named = name ? NAMED_ENTITIES[name.toLowerCase()] : undefined;
      return named ?? match;
    },
  );
}

/** Attributes of one tag, lower-cased names, entity-decoded values. */
function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // Skip the tag name itself.
  const body = tag.replace(/^<\s*[a-zA-Z][^\s/>]*/, "");
  for (const match of body.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (!name || result.has(name)) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    result.set(name, decodeHtmlEntities(raw));
  }
  return result;
}

export interface ParsedLinkPage {
  title: string;
  description: string;
  siteName: string;
  image: LinkPreviewImage | null;
  /** Discovered `application/json+oembed` endpoint, absolute. */
  oembedUrl: string | null;
}

/**
 * The tags a preview reads, pulled out of raw HTML with no DOM. Open Graph
 * wins, then Twitter cards, then the document's own `<title>` and
 * description. The first tag of each name counts, which is what browsers
 * and crawlers do too.
 */
export function parseLinkPage(html: string, baseUrl: string): ParsedLinkPage {
  const meta = new Map<string, string>();
  const headOnly = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(
    /<style\b[\s\S]*?<\/style\s*>/gi,
    "",
  );
  for (const match of headOnly.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (!key || content === undefined || meta.has(key)) continue;
    meta.set(key, content);
  }
  let oembedUrl: string | null = null;
  for (const match of headOnly.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const type = (attrs.get("type") ?? "").toLowerCase();
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (
      !rel.includes("alternate") ||
      (type !== "application/json+oembed" && type !== "text/json+oembed")
    )
      continue;
    const href = attrs.get("href");
    if (!href) continue;
    try {
      oembedUrl = linkPreviewUrl(new URL(href, baseUrl).toString());
    } catch {
      oembedUrl = null;
    }
    if (oembedUrl) break;
  }
  const titleTag = headOnly.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const title =
    text(meta.get("og:title"), LINK_TITLE_LIMIT) ||
    text(meta.get("twitter:title"), LINK_TITLE_LIMIT) ||
    text(titleTag ? decodeHtmlEntities(titleTag) : "", LINK_TITLE_LIMIT);
  const description =
    text(meta.get("og:description"), LINK_DESCRIPTION_LIMIT) ||
    text(meta.get("twitter:description"), LINK_DESCRIPTION_LIMIT) ||
    text(meta.get("description"), LINK_DESCRIPTION_LIMIT);
  const siteName = text(meta.get("og:site_name"), SITE_NAME_LIMIT);
  const imageSource =
    imageUrl(meta.get("og:image:secure_url"), baseUrl) ??
    imageUrl(meta.get("og:image"), baseUrl) ??
    imageUrl(meta.get("og:image:url"), baseUrl) ??
    imageUrl(meta.get("twitter:image"), baseUrl) ??
    imageUrl(meta.get("twitter:image:src"), baseUrl);
  return {
    title,
    description,
    siteName,
    image: imageSource
      ? {
          url: imageSource,
          width: dimension(meta.get("og:image:width")),
          height: dimension(meta.get("og:image:height")),
        }
      : null,
    oembedUrl,
  };
}

export interface OEmbedData {
  title: string;
  providerName: string;
  authorName: string;
  thumbnail: LinkPreviewImage | null;
}

/**
 * The oEmbed fields a card can draw. The `html` field is never used: it is
 * arbitrary markup from a third party, and the card is not an iframe host.
 */
export function normalizeOEmbed(payload: unknown): OEmbedData | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as {
    title?: unknown;
    provider_name?: unknown;
    author_name?: unknown;
    thumbnail_url?: unknown;
    thumbnail_width?: unknown;
    thumbnail_height?: unknown;
  };
  const thumbnail = imageUrl(source.thumbnail_url);
  const data: OEmbedData = {
    title: text(source.title, LINK_TITLE_LIMIT),
    providerName: text(source.provider_name, SITE_NAME_LIMIT),
    authorName: text(source.author_name, SITE_NAME_LIMIT),
    thumbnail: thumbnail
      ? {
          url: thumbnail,
          width: dimension(source.thumbnail_width),
          height: dimension(source.thumbnail_height),
        }
      : null,
  };
  if (!data.title && !data.providerName && !data.authorName && !data.thumbnail)
    return null;
  return data;
}

/**
 * One card from the page tags and the oEmbed answer, when there was one.
 * A page that names no title from any source has nothing to draw, so the
 * result is null and the block stays a normal link.
 */
export function linkPreviewFrom(
  url: string,
  page: ParsedLinkPage,
  oembed: OEmbedData | null,
): LinkPreviewData | null {
  const title = page.title || oembed?.title || "";
  if (!title) return null;
  const description = page.description || (oembed?.authorName ? `By ${oembed.authorName}` : "");
  return {
    url,
    title,
    description,
    siteName: page.siteName || oembed?.providerName || "",
    image: page.image ?? oembed?.thumbnail ?? null,
  };
}

export interface LinkPreviewCacheStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  readonly length?: number;
  key?: (index: number) => string | null;
}

interface LinkPreviewCacheEntry {
  data: LinkPreviewData;
  savedAt: number;
}

export function linkPreviewCacheKey(url: string): string {
  return `${CACHE_PREFIX}:${url}`;
}

/**
 * A stored entry is re-checked on the way out with the same scheme rules
 * as a fresh fetch, so an edited localStorage value cannot put a foreign
 * scheme in an `img` or an `href`.
 */
export function parseLinkPreviewData(
  value: unknown,
  url: string,
): LinkPreviewData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<LinkPreviewData>;
  const title = text(source.title, LINK_TITLE_LIMIT);
  if (!title) return undefined;
  const target = linkPreviewUrl(typeof source.url === "string" ? source.url : "") ?? url;
  const image = imageUrl(source.image?.url);
  return {
    url: target,
    title,
    description: text(source.description, LINK_DESCRIPTION_LIMIT),
    siteName: text(source.siteName, SITE_NAME_LIMIT),
    image: image
      ? {
          url: image,
          width: dimension(source.image?.width),
          height: dimension(source.image?.height),
        }
      : null,
  };
}

export function readLinkPreviewCacheEntry(
  storage: LinkPreviewCacheStorage | undefined,
  url: string,
  now: number = Date.now(),
): { data: LinkPreviewData; savedAt: number } | undefined {
  try {
    const raw = storage?.getItem(linkPreviewCacheKey(url));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Partial<LinkPreviewCacheEntry>;
    const savedAt = entry.savedAt;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return undefined;
    if (now - savedAt > LINK_PREVIEW_CACHE_TTL_MS) {
      storage?.removeItem(linkPreviewCacheKey(url));
      return undefined;
    }
    const data = parseLinkPreviewData(entry.data, url);
    return data ? { savedAt, data } : undefined;
  } catch {
    return undefined;
  }
}

function pruneLinkPreviewCache(storage: LinkPreviewCacheStorage): void {
  if (typeof storage.length !== "number" || typeof storage.key !== "function") return;
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(CACHE_NAMESPACE)) stale.push(key);
  }
  for (const key of stale) {
    try {
      storage.removeItem(key);
    } catch {
      /* One bad entry is not worth failing the write. */
    }
  }
}

export function writeLinkPreviewCache(
  storage: LinkPreviewCacheStorage | undefined,
  url: string,
  data: LinkPreviewData,
): void {
  if (!storage) return;
  const entry: LinkPreviewCacheEntry = { data, savedAt: Date.now() };
  try {
    storage.setItem(linkPreviewCacheKey(url), JSON.stringify(entry));
  } catch {
    // Quota is full of old previews. Drop them and retry once, then give
    // up: the session cache still works, only the next refresh refetches.
    try {
      pruneLinkPreviewCache(storage);
      storage.setItem(linkPreviewCacheKey(url), JSON.stringify(entry));
    } catch {
      /* The current session still shows the card. */
    }
  }
}

/**
 * Bookmark URLs in a page document, in document order. Used to start the
 * preview fetch while the editor chunk is still loading.
 */
export function bookmarkUrlsFromDocument(document: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const block = item as { type?: unknown; props?: unknown; children?: unknown };
      if (block.type === "bookmark" && block.props && typeof block.props === "object") {
        const raw = (block.props as { url?: unknown }).url;
        const url = typeof raw === "string" ? linkPreviewUrl(raw) : null;
        if (url && !seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      visit(block.children);
    }
  };
  visit(document);
  return urls;
}

/**
 * Cached tweet embeds. The widget script sends no CORS headers, so the
 * browser cannot fetch oEmbed HTML directly. The server fn fetches it,
 * React Query caches it in memory, and localStorage carries it across
 * refreshes so a reload paints the cached tweet text at once instead of
 * flashing empty while widgets.js loads.
 */

export type TweetTheme = "light" | "dark";

export interface TweetEmbedData {
  id: string;
  html: string;
  authorName: string;
  authorUrl: string;
}

const OEMBED_ENDPOINT = "https://publish.x.com/oembed";
const OEMBED_TIMEOUT_MS = 8_000;

/** Rejects absurd payloads before they reach the page or localStorage. */
export const TWEET_EMBED_HTML_LIMIT = 20_000;

/** localStorage entries outlive the session; a month matches X's cache age. */
export const TWEET_EMBED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CACHE_PREFIX = "hq:tweet-embed:v1";

export function tweetOembedUrl(id: string, theme: TweetTheme): string {
  const params = new URLSearchParams({
    // `/i/web/status/{id}` is what we store, but publish.x.com 404s on that
    // form. `/i/status/{id}` is the id-only URL oEmbed accepts.
    url: `https://x.com/i/status/${id}`,
    theme,
    dnt: "true",
    omit_script: "true",
    hide_thread: "true",
  });
  return `${OEMBED_ENDPOINT}?${params.toString()}`;
}

interface TweetOembedResponse {
  html?: unknown;
  author_name?: unknown;
  author_url?: unknown;
}

/**
 * Defense in depth: omit_script=true already drops scripts, but the HTML
 * ends up in dangerouslySetInnerHTML, so strip them here too and accept
 * only genuine tweet markup.
 */
export function sanitizeOembedHtml(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const withoutScripts = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    "",
  );
  if (!withoutScripts.includes("twitter-tweet")) return null;
  const trimmed = withoutScripts.trim();
  if (!trimmed || trimmed.length > TWEET_EMBED_HTML_LIMIT) return null;
  return trimmed;
}

export async function fetchTweetOembed(
  id: string,
  theme: TweetTheme,
  fetchImpl: typeof fetch = fetch,
): Promise<TweetEmbedData> {
  let response: Response;
  try {
    response = await fetchImpl(tweetOembedUrl(id, theme), {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not load tweet.");
  }
  if (!response.ok) throw new Error("Could not load tweet.");
  let body: TweetOembedResponse;
  try {
    body = (await response.json()) as TweetOembedResponse;
  } catch {
    throw new Error("Could not load tweet.");
  }
  const html = sanitizeOembedHtml(body.html);
  if (!html) throw new Error("Could not load tweet.");
  return {
    id,
    html,
    authorName: typeof body.author_name === "string" ? body.author_name : "",
    authorUrl: typeof body.author_url === "string" ? body.author_url : "",
  };
}

export interface TweetEmbedCacheStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  readonly length?: number;
  key?: (index: number) => string | null;
}

interface TweetEmbedCacheEntry {
  html: string;
  authorName: string;
  authorUrl: string;
  savedAt: number;
}

export function tweetEmbedCacheKey(id: string, theme: TweetTheme): string {
  return `${CACHE_PREFIX}:${theme}:${id}`;
}

export function readTweetEmbedCacheEntry(
  storage: TweetEmbedCacheStorage | undefined,
  id: string,
  theme: TweetTheme,
  now: number = Date.now(),
): { data: TweetEmbedData; savedAt: number } | undefined {
  try {
    const raw = storage?.getItem(tweetEmbedCacheKey(id, theme));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Partial<TweetEmbedCacheEntry>;
    const savedAt = entry.savedAt;
    if (
      typeof entry.html !== "string" ||
      typeof savedAt !== "number" ||
      !Number.isFinite(savedAt)
    ) {
      return undefined;
    }
    if (now - savedAt > TWEET_EMBED_CACHE_TTL_MS) {
      storage?.removeItem(tweetEmbedCacheKey(id, theme));
      return undefined;
    }
    const html = sanitizeOembedHtml(entry.html);
    if (!html) return undefined;
    return {
      savedAt,
      data: {
        id,
        html,
        authorName: typeof entry.authorName === "string" ? entry.authorName : "",
        authorUrl: typeof entry.authorUrl === "string" ? entry.authorUrl : "",
      },
    };
  } catch {
    return undefined;
  }
}

export function readTweetEmbedCache(
  storage: TweetEmbedCacheStorage | undefined,
  id: string,
  theme: TweetTheme,
  now: number = Date.now(),
): TweetEmbedData | undefined {
  return readTweetEmbedCacheEntry(storage, id, theme, now)?.data;
}

function pruneTweetEmbedCache(storage: TweetEmbedCacheStorage): void {
  if (typeof storage.length !== "number" || typeof storage.key !== "function") {
    return;
  }
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) stale.push(key);
  }
  for (const key of stale) {
    try {
      storage.removeItem(key);
    } catch {
      /* One bad entry is not worth failing the write. */
    }
  }
}

export function writeTweetEmbedCache(
  storage: TweetEmbedCacheStorage | undefined,
  id: string,
  theme: TweetTheme,
  data: TweetEmbedData,
): void {
  if (!storage) return;
  const entry: TweetEmbedCacheEntry = {
    html: data.html,
    authorName: data.authorName,
    authorUrl: data.authorUrl,
    savedAt: Date.now(),
  };
  try {
    storage.setItem(tweetEmbedCacheKey(id, theme), JSON.stringify(entry));
  } catch {
    // Quota is full of old tweets. Drop them and retry once, then give up:
    // the session cache still works, only the next refresh refetches.
    try {
      pruneTweetEmbedCache(storage);
      storage.setItem(tweetEmbedCacheKey(id, theme), JSON.stringify(entry));
    } catch {
      /* The current session still shows the tweet. */
    }
  }
}

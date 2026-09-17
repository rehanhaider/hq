/**
 * Cached tweet data. X sends no CORS headers, so a server fn fetches the
 * public syndication payload — the same unauthenticated endpoint Vercel's
 * react-tweet uses — and normalizes it into the small JSON shape below.
 * React Query keeps it in memory and localStorage carries it across
 * refreshes, so a reload paints the finished card at once: no widget
 * script, no iframe, nothing swapped in after the first frame.
 */

export type TweetTheme = "light" | "dark";

export type TweetSegmentType = "text" | "url" | "mention" | "hashtag";

export interface TweetSegment {
  type: TweetSegmentType;
  text: string;
  /** Absent on plain text. */
  href?: string;
}

export interface TweetPhoto {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface TweetVideo {
  poster: string;
  /** Highest-bitrate MP4, when X offers one. */
  src: string | null;
  width: number;
  height: number;
}

export interface TweetQuote {
  name: string;
  handle: string;
  text: string;
  permalink: string;
  /** The quoted post's own photos, if any. Rendered inside the quote box. */
  photos: TweetPhoto[];
}

export interface TweetEmbedData {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  verified: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** Display text, media links removed. */
  text: string;
  segments: TweetSegment[];
  photos: TweetPhoto[];
  video: TweetVideo | null;
  likes: number;
  replies: number;
  permalink: string;
  quote: TweetQuote | null;
}

const SYNDICATION_ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result";
const SYNDICATION_TIMEOUT_MS = 8_000;

/** Rejects absurd payloads before they reach the page or localStorage. */
export const TWEET_TEXT_LIMIT = 4_000;
const PHOTO_LIMIT = 4;

/** localStorage entries outlive the session; a month matches X's cache age. */
export const TWEET_EMBED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** v3 adds the quoted post's photos. v2 held the same shape without them. */
const CACHE_NAMESPACE = "hq:tweet-embed:";
const CACHE_PREFIX = `${CACHE_NAMESPACE}v3`;

/** Only X's own media hosts may reach an `img`, `video`, or `poster`. */
const MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);

/**
 * The token X's own embeds send. It is derived from the id, not a secret,
 * and the endpoint 404s without it.
 */
export function tweetSyndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function tweetSyndicationUrl(id: string): string {
  const params = new URLSearchParams({
    id,
    token: tweetSyndicationToken(id),
    lang: "en",
  });
  return `${SYNDICATION_ENDPOINT}?${params.toString()}`;
}

function text(value: unknown, limit = 200): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function dimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/** Media goes into `src`, so the host is checked, not just the scheme. */
function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return MEDIA_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
}

/** Links go into `href`, so anything but http(s) is dropped. */
function linkUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

function isoDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

export function tweetPermalink(handle: string, id: string): string {
  return handle
    ? `https://x.com/${handle}/status/${id}`
    : `https://x.com/i/web/status/${id}`;
}

interface RawEntity {
  indices?: unknown;
  text?: unknown;
  screen_name?: unknown;
  display_url?: unknown;
  expanded_url?: unknown;
}

interface EntityRange {
  start: number;
  end: number;
  segment: TweetSegment | null;
}

function indices(entity: RawEntity): [number, number] | null {
  const pair = entity.indices;
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const [start, end] = pair;
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start)
    return null;
  return [start, end];
}

function entityRanges(entities: unknown): EntityRange[] {
  const source = (entities ?? {}) as {
    urls?: unknown;
    hashtags?: unknown;
    user_mentions?: unknown;
    media?: unknown;
  };
  const ranges: EntityRange[] = [];
  const add = (
    list: unknown,
    toSegment: (entity: RawEntity) => TweetSegment | null,
  ) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const entity = item as RawEntity;
      const range = indices(entity);
      if (!range) continue;
      ranges.push({ start: range[0], end: range[1], segment: toSegment(entity) });
    }
  };
  add(source.urls, (entity) => {
    const href = linkUrl(entity.expanded_url);
    if (!href) return null;
    return { type: "url", text: text(entity.display_url) || href, href };
  });
  add(source.hashtags, (entity) => {
    const tag = text(entity.text, 100);
    if (!tag) return null;
    return {
      type: "hashtag",
      text: `#${tag}`,
      href: `https://x.com/hashtag/${encodeURIComponent(tag)}`,
    };
  });
  add(source.user_mentions, (entity) => {
    const handle = text(entity.screen_name, 100);
    if (!handle) return null;
    return {
      type: "mention",
      text: `@${handle}`,
      href: `https://x.com/${encodeURIComponent(handle)}`,
    };
  });
  // Media links are the trailing `pic.x.com/…` shortener. The photo grid
  // shows the media itself, so the link renders as nothing.
  add(source.media, () => null);
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Display text plus its links. X's indices count code points, not UTF-16
 * units, so an emoji before a link would shift every following index if
 * the string were sliced directly.
 */
export function tweetSegments(
  body: unknown,
  displayRange: unknown,
  entities: unknown,
): TweetSegment[] {
  const characters = Array.from(typeof body === "string" ? body : "");
  const range = Array.isArray(displayRange) ? displayRange : [];
  const from =
    typeof range[0] === "number" && range[0] >= 0 ? range[0] : 0;
  const to =
    typeof range[1] === "number" && range[1] <= characters.length
      ? range[1]
      : characters.length;
  const segments: TweetSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.type === "text") last.text += value;
    else segments.push({ type: "text", text: value });
  };
  let cursor = from;
  for (const range_ of entityRanges(entities)) {
    if (range_.end <= from || range_.start >= to) continue;
    if (range_.start < cursor) continue;
    pushText(characters.slice(cursor, range_.start).join(""));
    if (range_.segment) segments.push({ ...range_.segment });
    cursor = range_.end;
  }
  pushText(characters.slice(cursor, to).join(""));
  const last = segments[segments.length - 1];
  if (last?.type === "text") {
    last.text = last.text.replace(/\s+$/, "");
    if (!last.text) segments.pop();
  }
  const first = segments[0];
  if (first?.type === "text") {
    first.text = first.text.replace(/^\s+/, "");
    if (!first.text) segments.shift();
  }
  // Long quote-tweet payloads exist; the card is not a document viewer.
  let budget = TWEET_TEXT_LIMIT;
  const capped: TweetSegment[] = [];
  for (const segment of segments) {
    if (budget <= 0) break;
    capped.push({ ...segment, text: segment.text.slice(0, budget) });
    budget -= segment.text.length;
  }
  return capped;
}

function photos(payload: {
  photos?: unknown;
  mediaDetails?: unknown;
}): TweetPhoto[] {
  const details = Array.isArray(payload.mediaDetails) ? payload.mediaDetails : [];
  const alts = new Map<string, string>();
  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    const media = item as { media_url_https?: unknown; url?: unknown; ext_alt_text?: unknown };
    const url = mediaUrl(media.media_url_https) ?? mediaUrl(media.url);
    const alt = text(media.ext_alt_text, 500);
    if (url && alt) alts.set(url, alt);
  }
  const list = Array.isArray(payload.photos) ? payload.photos : [];
  const result: TweetPhoto[] = [];
  for (const item of list) {
    if (result.length >= PHOTO_LIMIT) break;
    if (!item || typeof item !== "object") continue;
    const photo = item as { url?: unknown; width?: unknown; height?: unknown; ext_alt_text?: unknown };
    const url = mediaUrl(photo.url);
    if (!url) continue;
    result.push({
      url,
      width: dimension(photo.width) || 1,
      height: dimension(photo.height) || 1,
      alt: text(photo.ext_alt_text, 500) || alts.get(url) || "",
    });
  }
  return result;
}

function video(value: unknown): TweetVideo | null {
  if (!value || typeof value !== "object") return null;
  const source = value as {
    poster?: unknown;
    variants?: unknown;
    aspectRatio?: unknown;
  };
  const poster = mediaUrl(source.poster);
  if (!poster) return null;
  let src: string | null = null;
  let bitrate = -1;
  if (Array.isArray(source.variants)) {
    for (const item of source.variants) {
      if (!item || typeof item !== "object") continue;
      const variant = item as { type?: unknown; src?: unknown; bitrate?: unknown };
      if (variant.type !== "video/mp4") continue;
      const url = mediaUrl(variant.src);
      if (!url) continue;
      const rate = count(variant.bitrate);
      if (rate > bitrate) {
        bitrate = rate;
        src = url;
      }
    }
  }
  const ratio = Array.isArray(source.aspectRatio) ? source.aspectRatio : [];
  return {
    poster,
    src,
    width: dimension(ratio[0]) || 16,
    height: dimension(ratio[1]) || 9,
  };
}

function quote(value: unknown): TweetQuote | null {
  if (!value || typeof value !== "object") return null;
  const source = value as {
    id_str?: unknown;
    text?: unknown;
    display_text_range?: unknown;
    entities?: unknown;
    user?: unknown;
    photos?: unknown;
    mediaDetails?: unknown;
  };
  const user = (source.user ?? {}) as { name?: unknown; screen_name?: unknown };
  const handle = text(user.screen_name, 100);
  const id = text(source.id_str, 20);
  if (!handle || !/^\d{1,20}$/.test(id)) return null;
  return {
    name: text(user.name) || handle,
    handle,
    text: tweetSegments(source.text, source.display_text_range, source.entities)
      .map((segment) => segment.text)
      .join("")
      .slice(0, 500),
    permalink: tweetPermalink(handle, id),
    photos: photos(source),
  };
}

/**
 * The syndication payload, reduced to what the card draws. Anything the
 * card cannot draw safely is dropped rather than patched, and the result
 * is plain JSON so the same value survives localStorage untouched.
 */
export function normalizeTweet(payload: unknown, id: string): TweetEmbedData | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as {
    id_str?: unknown;
    text?: unknown;
    display_text_range?: unknown;
    entities?: unknown;
    created_at?: unknown;
    favorite_count?: unknown;
    conversation_count?: unknown;
    user?: unknown;
    photos?: unknown;
    mediaDetails?: unknown;
    video?: unknown;
    quoted_tweet?: unknown;
  };
  const user = (source.user ?? {}) as {
    name?: unknown;
    screen_name?: unknown;
    profile_image_url_https?: unknown;
    verified?: unknown;
    is_blue_verified?: unknown;
  };
  const handle = text(user.screen_name, 100);
  if (!handle) return null;
  const tweetId = /^\d{1,20}$/.test(text(source.id_str, 20))
    ? text(source.id_str, 20)
    : id;
  if (!/^\d{1,20}$/.test(tweetId)) return null;
  const segments = tweetSegments(
    source.text,
    source.display_text_range,
    source.entities,
  );
  return {
    id: tweetId,
    name: text(user.name) || handle,
    handle,
    avatar: mediaUrl(user.profile_image_url_https) ?? "",
    verified: user.verified === true || user.is_blue_verified === true,
    createdAt: isoDate(source.created_at),
    text: segments.map((segment) => segment.text).join(""),
    segments,
    photos: photos(source),
    video: video(source.video),
    likes: count(source.favorite_count),
    replies: count(source.conversation_count),
    permalink: tweetPermalink(handle, tweetId),
    quote: quote(source.quoted_tweet),
  };
}

export async function fetchTweetData(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TweetEmbedData> {
  let response: Response;
  try {
    response = await fetchImpl(tweetSyndicationUrl(id), {
      signal: AbortSignal.timeout(SYNDICATION_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not load tweet.");
  }
  if (!response.ok) throw new Error("Could not load tweet.");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Could not load tweet.");
  }
  const data = normalizeTweet(body, id);
  if (!data) throw new Error("Could not load tweet.");
  return data;
}

export interface TweetEmbedCacheStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  readonly length?: number;
  key?: (index: number) => string | null;
}

interface TweetEmbedCacheEntry {
  data: TweetEmbedData;
  savedAt: number;
}

export function tweetEmbedCacheKey(id: string, theme: TweetTheme): string {
  return `${CACHE_PREFIX}:${theme}:${id}`;
}

/**
 * A stored entry is re-checked on the way out: the same host and scheme
 * rules as a fresh fetch, so an edited localStorage value cannot put a
 * foreign URL in an `img` or an `href`.
 */
export function parseTweetEmbedData(
  value: unknown,
  id: string,
): TweetEmbedData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<TweetEmbedData>;
  const handle = text(source.handle, 100);
  if (!handle || !Array.isArray(source.segments)) return undefined;
  const segments: TweetSegment[] = [];
  for (const item of source.segments) {
    if (!item || typeof item !== "object") continue;
    const segment = item as Partial<TweetSegment>;
    const body = text(segment.text, TWEET_TEXT_LIMIT);
    if (!body) continue;
    if (segment.type === "text" || !segment.type) {
      segments.push({ type: "text", text: body });
      continue;
    }
    const href = linkUrl(segment.href);
    if (!href) continue;
    segments.push({ type: segment.type, text: body, href });
  }
  const storedPhotos = Array.isArray(source.photos) ? source.photos : [];
  const photoList: TweetPhoto[] = [];
  for (const item of storedPhotos.slice(0, PHOTO_LIMIT)) {
    const url = mediaUrl(item?.url);
    if (!url) continue;
    photoList.push({
      url,
      width: dimension(item?.width) || 1,
      height: dimension(item?.height) || 1,
      alt: text(item?.alt, 500),
    });
  }
  const storedQuote = source.quote;
  const quoteHandle = text(storedQuote?.handle, 100);
  const quotePermalink = linkUrl(storedQuote?.permalink);
  const storedQuotePhotos = Array.isArray(storedQuote?.photos)
    ? storedQuote.photos
    : [];
  const quotePhotoList: TweetPhoto[] = [];
  for (const item of storedQuotePhotos.slice(0, PHOTO_LIMIT)) {
    const url = mediaUrl(item?.url);
    if (!url) continue;
    quotePhotoList.push({
      url,
      width: dimension(item?.width) || 1,
      height: dimension(item?.height) || 1,
      alt: text(item?.alt, 500),
    });
  }
  return {
    id,
    name: text(source.name) || handle,
    handle,
    avatar: mediaUrl(source.avatar) ?? "",
    verified: source.verified === true,
    createdAt: isoDate(source.createdAt),
    text: segments.map((segment) => segment.text).join(""),
    segments,
    photos: photoList,
    video: video(source.video),
    likes: count(source.likes),
    replies: count(source.replies),
    permalink: linkUrl(source.permalink) ?? tweetPermalink(handle, id),
    quote:
      quoteHandle && quotePermalink
        ? {
            name: text(storedQuote?.name) || quoteHandle,
            handle: quoteHandle,
            text: text(storedQuote?.text, 500),
            permalink: quotePermalink,
            photos: quotePhotoList,
          }
        : null,
  };
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
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) {
      return undefined;
    }
    if (now - savedAt > TWEET_EMBED_CACHE_TTL_MS) {
      storage?.removeItem(tweetEmbedCacheKey(id, theme));
      return undefined;
    }
    const data = parseTweetEmbedData(entry.data, id);
    return data ? { savedAt, data } : undefined;
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

/** Drops every tweet entry, including the v1 oEmbed HTML this replaced. */
function pruneTweetEmbedCache(storage: TweetEmbedCacheStorage): void {
  if (typeof storage.length !== "number" || typeof storage.key !== "function") {
    return;
  }
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

export function writeTweetEmbedCache(
  storage: TweetEmbedCacheStorage | undefined,
  id: string,
  theme: TweetTheme,
  data: TweetEmbedData,
): void {
  if (!storage) return;
  const entry: TweetEmbedCacheEntry = { data, savedAt: Date.now() };
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

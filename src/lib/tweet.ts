/**
 * Tweet status URLs the Content editor can turn into an embed. Hosts and the
 * `/status/{id}` path are the whole test; a profile, a search, or extra text
 * around the URL is left for ordinary paste.
 */
const TWEET_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
]);

const STATUS_PATH = /\/(?:status|statuses)\/(\d{1,20})(?:\/|$)/;

export function tweetStatusUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) return null;
  // The URL parser drops newlines and encodes spaces, so a tweet link with
  // text after it would otherwise parse as one long URL and pass the host and
  // path checks below. Anything with whitespace inside is not a lone URL.
  if (/\s/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (!TWEET_HOSTS.has(host)) return null;
  const id = parsed.pathname.match(STATUS_PATH)?.[1];
  if (!id) return null;
  return `https://x.com/i/web/status/${id}`;
}

export function tweetStatusId(value: string): string | null {
  const canonical = tweetStatusUrl(value);
  if (!canonical) return null;
  return canonical.slice(canonical.lastIndexOf("/") + 1) || null;
}

/**
 * Clipboard text that is a tweet URL, possibly as a one-line `text/uri-list`.
 * Two or more real lines means the user copied more than a URL, so paste
 * stays ordinary.
 */
export function tweetUrlFromPaste(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = tweetStatusUrl(trimmed);
  if (direct) return direct;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 1) return null;
  return tweetStatusUrl(lines[0] ?? "");
}

/**
 * Status ids from tweet blocks in a page document, in document order.
 * Used to start the embed fetch while the editor chunk is still loading.
 */
export function tweetIdsFromDocument(document: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const block = item as {
        type?: unknown;
        props?: unknown;
        children?: unknown;
      };
      if (block.type === "tweet" && block.props && typeof block.props === "object") {
        const url = (block.props as { url?: unknown }).url;
        if (typeof url === "string") {
          const id = tweetStatusId(url);
          if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
      visit(block.children);
    }
  };
  visit(document);
  return ids;
}

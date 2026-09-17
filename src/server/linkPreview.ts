import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import {
  linkPreviewFrom,
  linkPreviewUrl,
  normalizeOEmbed,
  parseLinkPage,
  type LinkPreviewData,
} from "../lib/linkPreview";

/**
 * Fetches a page on the browser's behalf and reduces it to card data. The
 * server is the one making the request, so every hostname — the pasted
 * one and each redirect hop — is resolved and refused when it points
 * inside the network. A private app still runs next to things that trust
 * localhost.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
/** Half a megabyte of HTML: the `<head>` is in the first few kilobytes. */
const MAX_HTML_BYTES = 512 * 1024;
const MAX_OEMBED_BYTES = 256 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; hq-link-preview/1.0; +https://github.com/rehanhaider/hq)";

export type HostLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/** Loopback, link-local, private, carrier-grade NAT, and unspecified. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false;
    if (/^fe[89ab]/.test(lower)) return false;
    return true;
  }
  return false;
}

export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa"))
    return false;
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(literal)) return isPublicAddress(literal);
  return true;
}

async function assertPublic(url: URL, lookup: HostLookup): Promise<void> {
  const hostname = url.hostname;
  if (!isPublicHostname(hostname)) throw new Error("Refused to fetch a local address.");
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) return;
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new Error("Could not resolve the link's host.");
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress))
    throw new Error("Refused to fetch a local address.");
}

/**
 * Reads at most `limit` bytes and stops there. A page that keeps going is
 * cut, not refused: the tags a preview needs come first.
 */
async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const room = limit - total;
    const chunk = value.length > room ? value.subarray(0, room) : value;
    chunks.push(chunk);
    total += chunk.length;
  }
  if (total >= limit) void reader.cancel().catch(() => undefined);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function charsetOf(contentType: string): string {
  const match = contentType.match(/charset\s*=\s*"?([\w.:-]+)"?/i);
  return match?.[1]?.toLowerCase() ?? "utf-8";
}

function decode(bytes: Uint8Array, contentType: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(contentType));
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

export interface FetchLinkOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
}

/**
 * GET with manual redirects, so each hop passes the same host check as the
 * first URL. Returns the final response and the URL it came from.
 */
async function fetchPublic(
  start: URL,
  accept: string,
  options: Required<FetchLinkOptions>,
): Promise<{ response: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, options.lookup);
    let response: Response;
    try {
      response = await options.fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { accept, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Could not reach the link.");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      void response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("The link redirected nowhere.");
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new Error("The link redirected somewhere unusable.");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:")
        throw new Error("The link redirected somewhere unusable.");
      url = next;
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`The link answered ${response.status}.`);
    }
    return { response, url };
  }
  throw new Error("The link redirected too many times.");
}

async function fetchOEmbed(
  endpoint: string,
  options: Required<FetchLinkOptions>,
): Promise<ReturnType<typeof normalizeOEmbed>> {
  try {
    const { response } = await fetchPublic(
      new URL(endpoint),
      "application/json",
      options,
    );
    const contentType = response.headers.get("content-type") ?? "";
    const bytes = await readCapped(response, MAX_OEMBED_BYTES);
    return normalizeOEmbed(JSON.parse(decode(bytes, contentType)));
  } catch {
    // oEmbed is a bonus on top of the page tags, never a reason to fail.
    return null;
  }
}

export async function fetchLinkPreview(
  value: string,
  options: FetchLinkOptions = {},
): Promise<LinkPreviewData> {
  const url = linkPreviewUrl(value);
  if (!url) throw new Error("Not a link that can be previewed.");
  const resolved: Required<FetchLinkOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    lookup: options.lookup ?? defaultLookup,
  };
  const { response, url: finalUrl } = await fetchPublic(
    new URL(url),
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    resolved,
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("The link is not a web page.");
  }
  const html = decode(await readCapped(response, MAX_HTML_BYTES), contentType);
  const base = finalUrl.toString();
  const page = parseLinkPage(html, base);
  const oembed = page.oembedUrl ? await fetchOEmbed(page.oembedUrl, resolved) : null;
  const data = linkPreviewFrom(linkPreviewUrl(base) ?? url, page, oembed);
  if (!data) throw new Error("The page has no preview.");
  return data;
}

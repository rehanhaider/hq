import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
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
 * inside the network, and the connection is then pinned to the address
 * that passed, so a name cannot answer differently for the check and the
 * connect. A private app still runs next to things that trust localhost.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
/**
 * A megabyte of HTML at most, and usually far less: reading stops once the
 * `<head>` closes. YouTube puts 700 KB of script before its tags, which is
 * what the ceiling is sized for.
 */
const MAX_HTML_BYTES = 1024 * 1024;
const HEAD_END = "</head>";
const MAX_OEMBED_BYTES = 256 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; hq-link-preview/1.0; +https://github.com/rehanhaider/hq)";

export type HostLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, "");
  // A trailing dotted quad (`::ffff:1.2.3.4`) becomes its two hex groups.
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text =
      text.slice(0, dotted.index) +
      ((a! << 8) | b!).toString(16) +
      ":" +
      ((c! << 8) | d!).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail].map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN,
  );
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Loopback, link-local, private, carrier-grade NAT, multicast, and
 * unspecified — in IPv4, in IPv6, and in every IPv6 form that carries an
 * IPv4 address inside it: mapped (`::ffff:`), translated (`::ffff:0:`),
 * compatible (`::a.b.c.d`), NAT64 (`64:ff9b::`), and 6to4 (`2002::/16`).
 * Node's URL parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so
 * the hex form is the one that reaches this check.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  if (family !== 6) return false;
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];
  const leadingZeros = (count: number) => groups.slice(0, count).every((g) => g === 0);
  // ::ffff:a.b.c.d and ::ffff:0:a.b.c.d
  if (leadingZeros(5) && g5 === 0xffff) return isPublicAddress(ipv4FromGroups(g6, g7));
  if (leadingZeros(4) && g4 === 0xffff && g5 === 0) return isPublicAddress(ipv4FromGroups(g6, g7));
  // ::, ::1, and the deprecated IPv4-compatible ::a.b.c.d
  if (leadingZeros(6)) return false;
  // NAT64 64:ff9b::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return isPublicAddress(ipv4FromGroups(g6, g7));
  // 6to4 2002:a.b.c.d::
  if (g0 === 0x2002) return isPublicAddress(ipv4FromGroups(g1, g2));
  // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8
  if ((g0 & 0xfe00) === 0xfc00) return false;
  if ((g0 & 0xffc0) === 0xfe80) return false;
  if ((g0 & 0xff00) === 0xff00) return false;
  return true;
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

/**
 * The address the connection must use: the literal itself, or the first
 * resolved address once every resolved address has passed.
 */
async function checkedAddress(url: URL, lookup: HostLookup): Promise<string> {
  const hostname = url.hostname;
  if (!isPublicHostname(hostname)) throw new Error("Refused to fetch a local address.");
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return literal;
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new Error("Could not resolve the link's host.");
  }
  const first = addresses[0];
  if (!first || !addresses.every(isPublicAddress))
    throw new Error("Refused to fetch a local address.");
  return first;
}

export interface TransportInit {
  headers: Record<string, string>;
  /** The address the socket must connect to, already checked. */
  address: string;
  signal: AbortSignal;
}

/** One GET, no redirects followed, answered as a fetch `Response`. */
export type LinkTransport = (url: string, init: TransportInit) => Promise<Response>;

function decodedBody(res: IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(createGunzip());
  if (encoding === "deflate") return res.pipe(createInflate());
  if (encoding === "br") return res.pipe(createBrotliDecompress());
  return res;
}

/**
 * Node's own http client rather than fetch, because it takes a `lookup`
 * option: the socket dials the address that was checked, while TLS still
 * verifies the certificate against the hostname.
 */
export const nodeTransport: LinkTransport = (url, init) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const family = isIP(init.address);
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      target,
      {
        method: "GET",
        headers: init.headers,
        signal: init.signal,
        lookup: (_hostname, options, callback) => {
          const opts = options as { all?: boolean };
          if (opts.all) {
            (callback as unknown as (
              error: null,
              addresses: { address: string; family: number }[],
            ) => void)(null, [{ address: init.address, family }]);
          } else {
            (callback as unknown as (
              error: null,
              address: string,
              family: number,
            ) => void)(null, init.address, family);
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (typeof value === "string") headers.set(name, value);
          else if (Array.isArray(value)) headers.set(name, value.join(", "));
        }
        const empty = status === 204 || status === 304 || status < 200;
        if (empty) res.resume();
        try {
          resolve(
            new Response(
              empty ? null : (Readable.toWeb(decodedBody(res)) as ReadableStream<Uint8Array>),
              { status: status >= 200 && status <= 599 ? status : 502, headers },
            ),
          );
        } catch (error) {
          res.resume();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end();
  });

/**
 * Reads at most `limit` bytes, or up to and including `stopAfter` when it
 * appears first, and stops there. A page that keeps going is cut, not
 * refused: the tags a preview needs come first.
 */
async function readCapped(
  response: Response,
  limit: number,
  stopAfter?: string,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  const latin1 = new TextDecoder("latin1");
  let total = 0;
  let tail = "";
  let stopped = false;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const room = limit - total;
    const chunk = value.length > room ? value.subarray(0, room) : value;
    chunks.push(chunk);
    total += chunk.length;
    if (stopAfter) {
      // The marker may straddle two chunks, so the previous chunk's end is kept.
      const window = tail + latin1.decode(chunk);
      if (window.toLowerCase().includes(stopAfter)) {
        stopped = true;
        break;
      }
      tail = window.slice(-stopAfter.length);
    }
  }
  if (stopped || total >= limit) void reader.cancel().catch(() => undefined);
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
  transport?: LinkTransport;
  lookup?: HostLookup;
}

/**
 * GET with redirects followed by hand, so each hop passes the same host
 * check as the first URL and dials the address that passed. Returns the
 * final response and the URL it came from.
 */
async function fetchPublic(
  start: URL,
  accept: string,
  options: Required<FetchLinkOptions>,
): Promise<{ response: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const address = await checkedAddress(url, options.lookup);
    let response: Response;
    try {
      response = await options.transport(url.toString(), {
        headers: { accept, "user-agent": USER_AGENT },
        address,
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
    transport: options.transport ?? nodeTransport,
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
  const html = decode(await readCapped(response, MAX_HTML_BYTES, HEAD_END), contentType);
  const base = finalUrl.toString();
  const page = parseLinkPage(html, base);
  const oembed = page.oembedUrl ? await fetchOEmbed(page.oembedUrl, resolved) : null;
  const data = linkPreviewFrom(linkPreviewUrl(base) ?? url, page, oembed);
  if (!data) throw new Error("The page has no preview.");
  return data;
}

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** A week. Avatars change rarely, and a stale one still identifies the org. */
export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Requested edge, in pixels: retina for the 28px tile, still tiny. */
const AVATAR_SIZE = 96;
/** Half a megabyte: an avatar is a few kilobytes, so this only stops abuse. */
const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * A GitHub login: letters, digits, and hyphens, never leading or trailing.
 * The filename is the login itself, so anything else is refused outright.
 */
export function isAvatarOrg(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value)
  );
}

/** The image kind, read from the bytes rather than trusted from the fetch. */
export function avatarMime(bytes: Uint8Array): string | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length > 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * Organisation and user pictures, fetched from GitHub's own CDN once and
 * served from disk after that. No token and no API budget: the `.png` shortcut
 * resolves on the CDN, so avatar reads never touch the rate limit.
 *
 * This is a cache, not data: it lives outside the database and the backups,
 * and anything missing is simply refetched.
 */
export class AvatarStore {
  private readonly inflight = new Map<string, Promise<Buffer | null>>();

  constructor(
    readonly directory: string,
    private readonly ttlMs: number = AVATAR_TTL_MS,
  ) {}

  private path(org: string) {
    return join(this.directory, org.toLowerCase());
  }

  /** The picture and its type, or null when GitHub has none for this login. */
  async read(org: string): Promise<{ bytes: Buffer; mime: string } | null> {
    if (!isAvatarOrg(org)) return null;
    const path = this.path(org);
    const cached = this.cached(path);
    if (cached && Date.now() - cached.mtime < this.ttlMs) return cached;
    const running = this.inflight.get(path) ?? this.refresh(org, path);
    this.inflight.set(path, running);
    try {
      const bytes = await running;
      if (bytes) {
        const mime = avatarMime(bytes);
        if (mime) return { bytes, mime };
      }
    } catch {
      /* a failed refresh falls through to the stale file below */
    } finally {
      if (this.inflight.get(path) === running) this.inflight.delete(path);
    }
    return cached;
  }

  private cached(path: string) {
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      return null;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return null;
    }
    const mime = avatarMime(bytes);
    return mime ? { bytes, mime, mtime } : null;
  }

  private async refresh(org: string, path: string): Promise<Buffer | null> {
    // The shortcut only names the picture; resolving it with HEAD downloads
    // nothing, and the single GET goes straight to the sized CDN address.
    const final = new URL(
      await resolveUrl(`https://github.com/${org.toLowerCase()}.png`),
    );
    if (final.hostname === "avatars.githubusercontent.com")
      final.searchParams.set("s", String(AVATAR_SIZE));
    const { response } = await fetchImage(final.toString());
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
      throw new Error(`GitHub has no picture for ${org}.`);
    const bytes = await readCapped(response);
    if (!avatarMime(bytes)) throw new Error(`GitHub has no picture for ${org}.`);
    mkdirSync(this.directory, { recursive: true });
    const staged = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(staged, bytes, { flag: "wx" });
      renameSync(staged, path);
    } catch (error) {
      rmSync(staged, { force: true });
      throw error;
    }
    return bytes;
  }
}

/**
 * Follows GitHub's shortcut redirect by hand, so the caller learns the final
 * URL: the sized GET needs the CDN address the shortcut resolves to. HEAD
 * downloads no body, so resolving costs headers only.
 */
async function resolveUrl(url: string, redirects = 3): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
  } catch {
    throw new Error("The picture could not be fetched.");
  }
  const location = response.headers.get("location");
  await response.body?.cancel().catch(() => undefined);
  if (
    redirects > 0 &&
    [301, 302, 303, 307, 308].includes(response.status) &&
    location
  )
    return resolveUrl(new URL(location, url).toString(), redirects - 1);
  return url;
}

/**
 * One GET, following any last-mile redirect the sized address answers with.
 * Returns the response with the URL it was read from.
 */
async function fetchImage(
  url: string,
  redirects = 3,
): Promise<{ response: Response; url: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
  } catch {
    throw new Error("The picture could not be fetched.");
  }
  const location = response.headers.get("location");
  if (
    redirects > 0 &&
    [301, 302, 303, 307, 308].includes(response.status) &&
    location
  ) {
    await response.body?.cancel().catch(() => undefined);
    return fetchImage(new URL(location, url).toString(), redirects - 1);
  }
  return { response, url };
}

async function readCapped(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The picture could not be read.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AVATAR_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The picture is larger than expected.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function resolveAvatarsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  if (env.HQ_AVATARS_DIR) return resolve(cwd, env.HQ_AVATARS_DIR);
  return resolve(cwd, "data/avatars");
}

let store: AvatarStore | undefined;
export function getAvatarStore() {
  return (store ??= new AvatarStore(resolveAvatarsDirectory()));
}

import type { ServerPlugin } from "srvx";

/** A year, and never revalidated while fresh, even on an explicit reload. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Where Vite writes the client build: every file name carries a content hash. */
const ASSETS_PREFIX = "/assets/";

/** The answers `srvx serve --static` gives for a file it found on disk. */
const SERVED_STATUSES = new Set([200, 206, 304]);

/**
 * Lets browsers keep the hashed client build for a year without asking again.
 *
 * `srvx serve --static` runs its file handler ahead of the server entry's own
 * middleware and sends no `Cache-Control`, so every reload revalidates each
 * file. A plugin runs before that handler is composed, so the middleware it
 * puts first wraps the static answer and adds the header. A new build renames
 * every file it changes, so a deploy still reaches the browser. Anything
 * outside `/assets/`, and a miss inside it, keeps the headers it had.
 */
export const immutableAssets: ServerPlugin = (server) => {
  (server.options.middleware ??= []).unshift(async (request, next) => {
    const response = await next();
    if (
      new URL(request.url).pathname.startsWith(ASSETS_PREFIX) &&
      SERVED_STATUSES.has(response.status)
    )
      response.headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
    return response;
  });
};

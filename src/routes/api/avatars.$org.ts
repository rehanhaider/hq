import { createFileRoute } from "@tanstack/react-router";
import { getAvatarStore, isAvatarOrg } from "@/server/avatars";

/**
 * A day. The server refreshes a picture weekly, so a browser holding
 * yesterday's copy is never far behind — and every org block on the Work page
 * loads its picture from local cache instead of GitHub's CDN.
 */
const CACHE_CONTROL = "public, max-age=86400";

export const Route = createFileRoute("/api/avatars/$org")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAvatarOrg(params.org))
          return new Response("Not found", { status: 404 });
        const found = await getAvatarStore().read(params.org);
        if (!found) return new Response("Not found", { status: 404 });
        const tag = `"${params.org.toLowerCase()}-${found.bytes.byteLength}"`;
        const headers = new Headers({
          "Content-Type": found.mime,
          "Cache-Control": CACHE_CONTROL,
          ETag: tag,
        });
        if (request.headers.get("if-none-match") === tag)
          return new Response(null, { status: 304, headers });
        headers.set("Content-Length", String(found.bytes.byteLength));
        return new Response(new Uint8Array(found.bytes), { headers });
      },
    },
  },
});

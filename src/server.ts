import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { immutableAssets } from "@/server/assetCache";
import { compressResponses } from "@/server/compression";

// `srvx serve` reads `plugins` from the entry's default export. The Vite dev
// server only calls `fetch`, so development keeps its own asset headers and
// sends pages uncompressed.
export default {
  ...createServerEntry({ fetch: handler.fetch }),
  plugins: [immutableAssets, compressResponses],
};

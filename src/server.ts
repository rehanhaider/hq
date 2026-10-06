import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { immutableAssets } from "@/server/assetCache";

// `srvx serve` reads `plugins` from the entry's default export. The Vite dev
// server only calls `fetch`, so development keeps its own asset headers.
export default {
  ...createServerEntry({ fetch: handler.fetch }),
  plugins: [immutableAssets],
};

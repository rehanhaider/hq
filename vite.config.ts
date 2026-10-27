import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { redact } from "@tanstack/redact/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Bundle every server dependency so Redact can redirect their React imports.
  // This also tree-shakes the icon barrels and shared controls on the server.
  ssr: { noExternal: true },
  plugins: [tailwindcss(), tanstackStart(), react(), redact()],
});

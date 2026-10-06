import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tree-shake the icon barrels and shared controls on the server too. Leaving
  // them external makes the first route import load thousands of unused icons.
  ssr: {
    noExternal: ["lucide-react", "@icons-pack/react-simple-icons", "@base-ui/react"],
  },
  plugins: [tailwindcss(), tanstackStart(), react()],
});

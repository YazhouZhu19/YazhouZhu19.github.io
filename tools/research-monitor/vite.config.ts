import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "/research-monitor/",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { fs: { strict: true } },
  build: { rollupOptions: { input: { zh: "index.html", en: "en/index.html" } } },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { bundleReport } from "./scripts/bundle-report";

export default defineConfig({
  base: "/research-monitor/",
  plugins: [react(), bundleReport()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { fs: { strict: true } },
  build: {
    manifest: true,
    rolldownOptions: {
      input: { zh: "index.html", en: "en/index.html" },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "vendor-ui",
              test: /node_modules[\\/](?:@radix-ui|radix-ui|@base-ui|@floating-ui)[\\/]/,
              priority: 10,
              entriesAware: false,
            },
          ],
        },
      },
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "zh", use: { baseURL: "http://127.0.0.1:4174/research-monitor/", locale: "zh-CN" } },
    { name: "en", use: { baseURL: "http://127.0.0.1:4174/research-monitor/en/", locale: "en-US" } },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --outDir .e2e-dist --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/research-monitor/fixture-info.json",
    reuseExistingServer: false,
    timeout: 30000,
  },
});

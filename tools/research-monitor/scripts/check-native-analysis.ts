import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Review the native application against its real production snapshot, never fixture data.
const origin = "http://127.0.0.1:4176";
const base = `${origin}/research-monitor/`;
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4176", "--strictPort"],
  { stdio: "pipe" },
);
let serverLog = "";
server.stdout?.on("data", (chunk) => {
  serverLog += String(chunk);
});
server.stderr?.on("data", (chunk) => {
  serverLog += String(chunk);
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview failed: ${serverLog}`);
    try {
      if ((await fetch(base)).ok) {
        started = true;
        break;
      }
    } catch {
      /* wait for our preview */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(started, "Local production preview did not start");
  const manifest = await (await fetch(`${base}data/public-papers-v3.json`)).json();
  assert.ok(manifest.totalStored >= 10000, "Expected the real paper snapshot, not an E2E fixture");
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    colorScheme: "light",
  });
  const errors: string[] = [],
    external: string[] = [],
    models: string[] = [],
    fullDownloads: string[] = [],
    analysisDownloads: string[] = [];
  context.on("request", (request) => {
    if (
      /\/data\/(?:public-papers|papers(?:\.json|\/)|paper-overview|research-signals|signals-v2\/)/.test(
        request.url(),
      )
    )
      fullDownloads.push(request.url());
    if (/analysis-(?:bootstrap|manifest|summary)\.json/.test(request.url()))
      analysisDownloads.push(request.url());
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== origin) {
      external.push(url);
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/ai-worker|webllm|web-llm|\/assets\/lib-/.test(request.url())) models.push(request.url());
  });
  const startedAt = performance.now();
  await page.goto(`${base}#/analysis`);
  const panel = page.locator(".integrated-analysis");
  const history = panel.locator(".analysis-history");
  await expect(history.locator("article[data-history-id]")).toHaveCount(3, { timeout: 10000 });
  const historyReadyMs = Math.round(performance.now() - startedAt);
  await expect(history.locator('[data-history-count="works"]')).toHaveText("14");
  await expect(
    page.locator(".workspace-main-nav").getByRole("button", { name: "分析", exact: true }),
  ).toBeVisible();
  await expect(panel.locator("iframe")).toHaveCount(0);
  const run = panel.getByRole("button", { name: "查看规则分析", exact: true });
  await expect(run).toBeEnabled({ timeout: 15000 });
  const analysisReadyMs = Math.round(performance.now() - startedAt);
  assert.match(
    await panel.locator(".integrated-toolbar").innerText(),
    new RegExp(manifest.totalStored.toLocaleString()),
  );
  await mkdir("docs/screenshots/native-analysis", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/native-analysis/workspace-desktop.png", fullPage: true });
  const status = panel.getByRole("group", { name: "积累证据状态" });
  await status.getByRole("button", { name: "证据充分", exact: true }).click();
  await expect(history.locator("article[data-history-id]")).toHaveCount(1);
  const card = history.locator('article[data-history-id="spinal-cord-mri"]');
  await card.locator("button[data-history-toggle]").click();
  await card.locator('details[data-history-section="datasets"] > summary').click();
  const datasets = card.locator('details[data-history-section="datasets"]');
  await expect(datasets).toContainText("260");
  await expect(datasets).toContainText("267");
  await datasets.screenshot({ path: "docs/screenshots/native-analysis/data-timeline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await history.screenshot({ path: "docs/screenshots/native-analysis/history-mobile.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await history.screenshot({ path: "docs/screenshots/native-analysis/history-mobile-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.getByRole("button", { name: "主流研究方向", exact: true }).click();
  const viewStartedAt = performance.now();
  await run.click();
  await expect(panel.locator(".integrated-directions > article")).toHaveCount(7, { timeout: 90000 });
  const resultsVisibleMs = Math.round(performance.now() - viewStartedAt);
  const currentCounts = await panel.locator(".integrated-counts strong").allTextContents();
  const published = JSON.parse(await readFile("dist/analysis-bootstrap.json", "utf8"));
  assert.deepEqual(
    currentCounts,
    ["paper", "github", "news"].map((kind) => published.result.totals[kind].toLocaleString()),
  );
  assert.ok(Number(currentCounts[0].replaceAll(",", "")) >= 5000);
  await page.screenshot({ path: "docs/screenshots/native-analysis/mainstream-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(models, []);
  assert.deepEqual(fullDownloads, []);
  const paperManifestBytes = await readFile("dist/data/public-papers-v3.json");
  const signalManifestBytes = await readFile("dist/data/signals-v2/manifest.json");
  const oldPaperManifest = JSON.parse(paperManifestBytes.toString());
  const oldSignalManifest = JSON.parse(signalManifestBytes.toString());
  const previousDataBytes =
    paperManifestBytes.length +
    signalManifestBytes.length +
    [...oldPaperManifest.shards, ...oldSignalManifest.shards].reduce((sum, shard) => sum + shard.bytes, 0);
  const analysisDataBytes =
    (await readFile("dist/analysis-bootstrap.json")).length +
    (await readFile("dist/data/analysis-manifest.json")).length;
  const report = {
    paperCount: manifest.totalStored,
    historyTopics: 3,
    historyWorks: 14,
    sufficient: 1,
    pending: 2,
    mainstreamDirections: 7,
    currentCounts,
    desktop: true,
    mobile: true,
    darkTheme: true,
    externalRequests: 0,
    modelRequests: 0,
    pageErrors: 0,
    analysisAsOf: published.result.asOf,
    historyReadyMs,
    analysisReadyMs,
    resultsVisibleMs,
    previousDataBytes,
    analysisDataBytes,
    dataReductionPercent: Number(((1 - analysisDataBytes / previousDataBytes) * 100).toFixed(2)),
    previousDataRequests: 2 + oldPaperManifest.shards.length + oldSignalManifest.shards.length,
    analysisDataRequests: analysisDownloads.length,
    fullDataRequests: fullDownloads.length,
    timingEnvironment:
      "Local production preview, cold browser; timings are not a claim about Internet latency.",
  };
  await writeFile("docs/analysis-loading-browser-check.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

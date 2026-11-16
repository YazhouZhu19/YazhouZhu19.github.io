import type { BrowserContext, Page } from "@playwright/test";
import { parseAnalysisTransport } from "../lib/analysis-transport";
import { test, expect, openHome } from "./test-support";

// Include Worker requests: page-only observation can miss the expensive source downloads.
const fullData =
  /\/data\/(?:public-papers-v\d+\.json|papers(?:\.json|\/)|paper-overview\.json|research-signals\.json|signals-v2\/)/;
const lightData = /\/(?:analysis-bootstrap|data\/analysis-(?:manifest|summary))(?:-v2)?\.json(?:\?|$)/;
const deferredChunks = /\/assets\/(?:research-dashboard|paper-code-links)-[^/]+\.js(?:\?|$)/;
const analysisChunks =
  /\/assets\/(?:integrated-analysis|analysis-store|analysis-history-panel)-[^/]+\.js(?:\?|$)/;
const initialAnalysisPaths = [
  "/research-monitor/analysis-bootstrap-v2.json",
  "/research-monitor/data/analysis-manifest-v2.json",
].sort();

async function unavailableFullSources(context: BrowserContext) {
  const requests: string[] = [];
  context.on("request", (request) => {
    if (fullData.test(request.url())) requests.push(request.url());
  });
  await context.route(fullData, (route) => route.fulfill({ status: 503, body: "Full sources unavailable" }));
  return requests;
}

function panel(page: Page) {
  return page.locator(".integrated-analysis");
}

test("direct analysis starts one bootstrap before React and reuses it when the store loads", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const requests: string[] = [];
  context.on("request", (request) => {
    if (lightData.test(request.url())) requests.push(new URL(request.url()).pathname);
  });
  let release!: () => void;
  const mainBlocked = new Promise<void>((resolve) => (release = resolve));
  await context.route(/\/assets\/main-[^/]+\.js(?:\?|$)/, async (route) => {
    await mainBlocked;
    await route.continue();
  });
  try {
    await page.goto("./#/analysis?scope=all", { waitUntil: "commit" });
    await expect.poll(() => requests).toEqual(["/research-monitor/analysis-bootstrap-v2.json"]);
    await expect(panel(page)).toHaveCount(0);
    release();
    await expect(
      panel(page).getByRole("button", { name: en ? "View rule analysis" : "查看规则分析", exact: true }),
    ).toBeEnabled();
    await expect.poll(() => [...requests].sort()).toEqual(initialAnalysisPaths);
  } finally {
    release();
  }
});

test("a non-analysis first screen does not preload analysis modules or data", async ({ page, context }) => {
  const requests: string[] = [];
  context.on("request", (request) => {
    if (lightData.test(request.url()) || analysisChunks.test(request.url())) requests.push(request.url());
  });
  await openHome(page);
  expect(requests).toEqual([]);
});

test("analysis preload transfers each style once and waits for slow history CSS before rendering", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const styles: string[] = [];
  context.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith(".css")) styles.push(path);
  });
  let release!: () => void;
  const slowCss = new Promise<void>((resolve) => (release = resolve));
  await context.route(/\/assets\/analysis-history-panel-[^/]+\.css(?:\?|$)/, async (route) => {
    await slowCss;
    await route.continue();
  });
  try {
    await page.goto("./#/analysis", { waitUntil: "domcontentloaded" });
    const analysis = panel(page);
    await expect(
      analysis.getByText(en ? "Loading reviewed research history…" : "正在载入已核查的研究积累…", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(analysis.locator(".analysis-history article[data-history-id]")).toHaveCount(0);
    await expect(page.locator('link[rel="stylesheet"][href*="analysis-history-panel-"]')).toHaveCount(1);
    release();
    await expect(analysis.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
    expect(styles.filter((path, index) => styles.indexOf(path) !== index)).toEqual([]);
    const repeatedModuleHints = await page.locator('link[rel="modulepreload"]').evaluateAll((links) => {
      const urls = links.map((link) => (link as HTMLLinkElement).href);
      return urls.filter((url, index) => urls.indexOf(url) !== index);
    });
    expect(repeatedModuleHints).toEqual([]);
  } finally {
    release();
  }
});

test("reviewed history renders while the published analysis is still downloading", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const fullRequests = await unavailableFullSources(context);
  let release!: () => void;
  const downloading = new Promise<void>((resolve) => (release = resolve));
  await context.route(lightData, async (route) => {
    await downloading;
    await route.continue();
  });
  try {
    await page.goto("./#/analysis");
    const history = panel(page).locator(".analysis-history");
    await expect(history.locator("article[data-history-id]")).toHaveCount(3);
    for (const [metric, value] of Object.entries({ topics: "3", works: "14", sufficient: "1", pending: "2" }))
      await expect(history.locator(`[data-history-count="${metric}"]`)).toHaveText(value);
    const view = panel(page).getByRole("button", {
      name: en ? "View rule analysis" : "查看规则分析",
      exact: true,
    });
    await expect(view).toBeDisabled();
    expect(fullRequests).toEqual([]);
    release();
    await expect(view).toBeEnabled();
    expect(fullRequests).toEqual([]);
  } finally {
    release();
  }
});

test("published results preserve counts and evidence without loading the full sources", async ({
  page,
  context,
  request,
}, info) => {
  const en = info.project.name === "en";
  const response = await request.get("/research-monitor/data/analysis-summary-v2.json");
  expect(response.ok()).toBe(true);
  const snapshot = parseAnalysisTransport(await response.json());
  const fullRequests = await unavailableFullSources(context);
  const analysisRequests: string[] = [];
  const unusedChunks: string[] = [];
  context.on("request", (request) => {
    if (lightData.test(request.url())) analysisRequests.push(request.url());
    if (deferredChunks.test(request.url())) unusedChunks.push(request.url());
  });
  await page.goto("./#/analysis");
  const analysis = panel(page);
  await expect(analysis.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  await analysis
    .getByRole("button", {
      name: en ? "Mainstream directions" : "主流研究方向",
      exact: true,
    })
    .click();
  const view = analysis.getByRole("button", {
    name: en ? "View rule analysis" : "查看规则分析",
    exact: true,
  });
  await expect(view).toBeEnabled();
  await view.click();
  const cards = analysis.locator(".integrated-directions > article");
  await expect(cards).toHaveCount(7);
  await expect(analysis.locator(".integrated-counts strong")).toHaveText(
    ["paper", "github", "news"].map((kind) =>
      snapshot.result.totals[kind as "paper" | "github" | "news"].toLocaleString(),
    ),
  );
  await expect(analysis.locator("#integrated-mainstream-panel")).toContainText(snapshot.result.asOf);
  await expect(analysis.locator("#integrated-mainstream-panel")).toContainText(snapshot.result.windowStart);
  for (const [index, direction] of snapshot.result.directions.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(direction.label[en ? "en" : "zh"]);
    await expect(card.locator(".integrated-score strong")).toHaveText(
      `${(direction.score * 100).toFixed(1)}%`,
    );
    if (direction.evidence.length) {
      await card.locator(":scope > details > summary").click();
      for (const evidence of direction.evidence)
        await expect(card.locator(":scope > details")).toContainText(evidence.title);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect
    .poll(() => analysisRequests.map((url) => new URL(url).pathname).sort())
    .toEqual(initialAnalysisPaths);
  expect(unusedChunks, "The dashboard and collapsed retrieval tool are outside the first screen").toEqual([]);
  expect(fullRequests, "Neither the first screen nor rule results need the full source archives").toEqual([]);
});

test("the paper-code tool loads its module only when expanded and its sources only when run", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const fullRequests = await unavailableFullSources(context);
  const chunks: string[] = [];
  context.on("request", (request) => {
    if (deferredChunks.test(request.url())) chunks.push(new URL(request.url()).pathname);
  });
  await page.goto("./#/analysis");
  const tool = panel(page).locator("details.paper-code-links");
  await expect(tool.locator(":scope > summary")).toBeVisible();
  expect(chunks).toEqual([]);
  await tool.locator(":scope > summary").click();
  await expect(
    tool.getByRole("button", { name: en ? "Find code associations" : "查找代码关联", exact: true }),
  ).toBeVisible();
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatch(/\/paper-code-links-(?!worker-)[^/]+\.js$/);
  expect(fullRequests).toEqual([]);
  await tool.locator(":scope > summary").click();
  await tool.locator(":scope > summary").click();
  expect(chunks).toHaveLength(1);
});

test("opening an analysis paper loads complete records only on demand", async ({ page, context }, info) => {
  const en = info.project.name === "en";
  const fullRequests: string[] = [];
  context.on("request", (request) => {
    if (fullData.test(request.url())) fullRequests.push(request.url());
  });
  await page.goto("./#/analysis");
  const analysis = panel(page);
  await analysis
    .getByRole("button", {
      name: en ? "Mainstream directions" : "主流研究方向",
      exact: true,
    })
    .click();
  const view = analysis.getByRole("button", {
    name: en ? "View rule analysis" : "查看规则分析",
    exact: true,
  });
  await expect(view).toBeEnabled();
  await view.click();
  await expect(analysis.locator(".integrated-directions > article")).toHaveCount(7);
  expect(fullRequests).toEqual([]);
  const direction = analysis.locator(".integrated-directions > article").first();
  await direction.locator(":scope > details > summary").click();
  await direction.locator(":scope > details .integrated-evidence button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(fullRequests.some((url) => url.includes("/public-papers-v3.json"))).toBe(true);
  expect(fullRequests.some((url) => url.includes("/signals-v2/"))).toBe(false);
  await expect(page.getByRole("dialog")).toContainText(
    /deep learning|neural network|foundation model|artificial intelligence|transformer/,
  );
});

test("an unavailable analysis loader offers explicit reload and recovers the same page", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const fullRequests = await unavailableFullSources(context);
  let chunkRequests = 0;
  let fail = true;
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++;
  });
  await context.route(/\/assets\/analysis-store-[^/]+\.js(?:\?|$)/, (route) => {
    chunkRequests++;
    return fail
      ? route.fulfill({ status: 503, contentType: "text/plain", body: "Temporarily unavailable" })
      : route.continue();
  });
  await page.goto("./#/analysis");
  const analysis = panel(page);
  await expect(analysis.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  const reload = analysis.getByRole("button", { name: en ? "Reload page" : "刷新页面", exact: true });
  const view = analysis.getByRole("button", {
    name: en ? "View rule analysis" : "查看规则分析",
    exact: true,
  });
  await expect(reload).toBeEnabled();
  await expect(view).toBeDisabled();
  expect(chunkRequests, "The failure must target the loader module").toBeGreaterThan(0);
  const failedRequests = chunkRequests;
  expect(documentLoads, "Module failures must not cause an automatic reload loop").toBe(1);
  const failedUrl = page.url();
  fail = false;
  await Promise.all([page.waitForEvent("domcontentloaded"), reload.click()]);
  await expect(view).toBeEnabled();
  await expect(reload).not.toBeVisible();
  expect(page.url()).toBe(failedUrl);
  expect(documentLoads).toBe(2);
  expect(chunkRequests).toBeGreaterThan(failedRequests);
  await analysis
    .getByRole("button", { name: en ? "Mainstream directions" : "主流研究方向", exact: true })
    .click();
  await view.click();
  await expect(analysis.locator(".integrated-directions > article")).toHaveCount(7);
  expect(fullRequests).toEqual([]);
});

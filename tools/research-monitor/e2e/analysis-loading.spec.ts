import type { BrowserContext, Page } from "@playwright/test";
import type { AnalysisSnapshot } from "../lib/analysis-snapshot";
import { test, expect } from "./test-support";

// Include Worker requests: page-only observation can miss the expensive source downloads.
const fullData =
  /\/data\/(?:public-papers-v\d+\.json|papers(?:\.json|\/)|paper-overview\.json|research-signals\.json|signals-v2\/)/;
const lightData = /\/(?:analysis-bootstrap|data\/analysis-(?:manifest|summary))\.json(?:\?|$)/;

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
  const response = await request.get("/research-monitor/data/analysis-summary.json");
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as AnalysisSnapshot;
  const fullRequests = await unavailableFullSources(context);
  const analysisRequests: string[] = [];
  context.on("request", (request) => {
    if (lightData.test(request.url())) analysisRequests.push(request.url());
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
  expect(analysisRequests.length).toBeGreaterThan(0);
  expect(fullRequests, "Neither the first screen nor rule results need the full source archives").toEqual([]);
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
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++;
  });
  await context.route(/\/assets\/analysis-store-[^/]+\.js(?:\?|$)/, (route) =>
    ++chunkRequests === 1
      ? route.fulfill({ status: 503, contentType: "text/plain", body: "Temporarily unavailable" })
      : route.continue(),
  );
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
  expect(chunkRequests, "The failure must target the loader module").toBe(1);
  expect(documentLoads, "Module failures must not cause an automatic reload loop").toBe(1);
  const failedUrl = page.url();
  await Promise.all([page.waitForEvent("domcontentloaded"), reload.click()]);
  await expect(view).toBeEnabled();
  await expect(reload).not.toBeVisible();
  expect(page.url()).toBe(failedUrl);
  expect(documentLoads).toBe(2);
  expect(chunkRequests).toBe(2);
  await analysis
    .getByRole("button", { name: en ? "Mainstream directions" : "主流研究方向", exact: true })
    .click();
  await view.click();
  await expect(analysis.locator(".integrated-directions > article")).toHaveCount(7);
  expect(fullRequests).toEqual([]);
});

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openHome } from "./test-support";

// Targeted run after rebuilding fixture assets:
// npm run e2e:prepare
// Without npm: node node_modules/vite/bin/vite.js build --outDir .e2e-dist
//              node --import tsx e2e/build-fixtures.ts
// node node_modules/@playwright/test/cli.js test e2e/integrated-analysis.spec.ts --workers=1
// The native history assertions describe the frozen 2026-11-17 evidence snapshot,
// independently of the synthetic live-source fixture. They do not measure scientific accuracy.
const analysisPanel = (page: Page, en: boolean) =>
  page.getByRole("region", { name: en ? "Integrated analysis" : "综合分析", exact: true });
const category = (panel: Locator, en: boolean, niche: boolean) =>
  panel.getByRole("button", {
    name: niche
      ? en
        ? "Niche trajectories"
        : "小众积累方向"
      : en
        ? "Mainstream directions"
        : "主流研究方向",
    exact: true,
  });
const statuses = (panel: Locator, en: boolean) =>
  panel.getByRole("group", { name: en ? "Accumulation evidence status" : "积累证据状态" });
const statusButton = (panel: Locator, en: boolean, status: "all" | "sufficient" | "pending") =>
  statuses(panel, en).getByRole("button", {
    name:
      status === "all"
        ? en
          ? "All directions"
          : "全部方向"
        : status === "sufficient"
          ? en
            ? "Evidence sufficient"
            : "证据充分"
          : en
            ? "Evidence pending"
            : "待补证据",
    exact: true,
  });

async function openAnalysis(page: Page, en: boolean) {
  await openHome(page);
  await page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: en ? "Analysis" : "分析", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: en ? "Analysis" : "分析", exact: true })).toBeVisible();
  return analysisPanel(page, en);
}

async function openHistorySection(card: Locator, section: string) {
  const details = card.locator(`details[data-history-section="${section}"]`);
  await expect(details).toBeVisible();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    const summary = details.locator(":scope > summary");
    await summary.focus();
    await expect(summary).toBeFocused();
    await summary.press("Enter");
  }
  await expect(details).toHaveAttribute("open", "");
  return details;
}

function recordModelRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/ai-worker|web-llm|webllm|mlc-ai|\/assets\/lib-|api\.openai\.com|anthropic/i.test(request.url()))
      requests.push(request.url());
  });
  return requests;
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(widths.page, "Native analysis must fit the viewport").toBeLessThanOrEqual(widths.viewport + 1);
}

test("Analysis replaces outlook navigation and legacy bookmarks open both native categories", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  const modelRequests = recordModelRequests(page);
  const panel = await openAnalysis(page, en);
  await expect(page).toHaveURL(/#\/analysis(?:\?|$)/);
  await expect(
    page.locator(".workspace-main-nav").getByRole("button", { name: /^(方向研判|Direction outlook)$/i }),
  ).toHaveCount(0);
  await expect(category(panel, en, true)).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  await expect(panel.locator("iframe")).toHaveCount(0);

  await category(panel, en, false).click();
  await expect(category(panel, en, false)).toHaveAttribute("aria-pressed", "true");
  const run = panel.getByRole("button", { name: en ? "View rule analysis" : "查看规则分析", exact: true });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(panel.locator(".integrated-directions article")).toHaveCount(7);
  await category(panel, en, true).click();
  await expect(panel.locator(".analysis-history article[data-history-id]")).toHaveCount(3);

  await page.goto("./#/outlook?scope=all");
  await expect(page.getByRole("heading", { name: en ? "Analysis" : "分析", exact: true })).toBeVisible();
  await expect(analysisPanel(page, en).locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  expect(modelRequests).toEqual([]);
});

test("native history is ready before running analysis and supports status and text filters", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  const panel = await openAnalysis(page, en);
  const history = panel.locator(".analysis-history");
  const cards = history.locator("article[data-history-id]");
  await expect(cards).toHaveCount(3);
  await expect(panel.locator(".integrated-directions article")).toHaveCount(0);
  for (const [metric, value] of Object.entries({ topics: "3", works: "14", sufficient: "1", pending: "2" }))
    await expect(history.locator(`[data-history-count="${metric}"]`)).toHaveText(value);
  await expect(statusButton(panel, en, "all")).toHaveAttribute("aria-pressed", "true");

  await statusButton(panel, en, "sufficient").click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-history-id", "spinal-cord-mri");
  await expect(cards.first()).toHaveAttribute("data-evidence-status", "sufficient");
  await statusButton(panel, en, "pending").click();
  await expect(cards).toHaveCount(2);
  await expect(history.locator('article[data-evidence-status="sufficient"]')).toHaveCount(0);

  const search = panel.getByLabel(en ? "Search research directions" : "搜索研究方向", { exact: true });
  await search.fill("QSM");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-history-id", "qsm-reconstruction");
  await statusButton(panel, en, "all").click();
  await search.fill("脊髓");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-history-id", "spinal-cord-mri");
  await search.fill("oevryn-unmatched-direction-987654321");
  await expect(cards).toHaveCount(0);
  await search.fill("");
  await expect(cards).toHaveCount(3);
});

test("native history exposes keyboard-operable timelines and original source anchors", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  const modelRequests = recordModelRequests(page);
  const panel = await openAnalysis(page, en);
  const card = panel.locator('.analysis-history article[data-history-id="spinal-cord-mri"]');
  const toggle = card.locator("button[data-history-toggle]");
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const papers = await openHistorySection(card, "papers");
  await expect(papers).toContainText("2016-10-05");
  await expect(papers).toContainText("2024-07-02");
  const datasets = await openHistorySection(card, "datasets");
  await expect(datasets).toContainText("2020-08-26");
  await expect(datasets).toContainText("2021-11-25");
  await expect(datasets.locator(".analysis-history-participants")).toHaveText([/^260\b/, /^267\b/, /^267\b/]);
  await expect(
    datasets.locator('a[href="https://github.com/spine-generic/data-multi-subject/releases/tag/r20211125"]'),
  ).toBeVisible();
  const repositories = await openHistorySection(card, "repositories");
  await expect(repositories).toContainText("2026-11-16");
  await expect(repositories).toContainText("2026-05-09");
  await expect(
    repositories.locator('a[href="https://github.com/spinalcordtoolbox/spinalcordtoolbox/releases/tag/7.3"]'),
  ).toBeVisible();
  const sources = await openHistorySection(card, "sources");
  const links = sources.locator("a[href]");
  expect(await links.count()).toBeGreaterThan(0);
  const malformed = await links.evaluateAll((anchors) =>
    anchors
      .filter((anchor) => {
        const url = new URL((anchor as HTMLAnchorElement).href);
        return (
          url.protocol !== "https:" ||
          anchor.getAttribute("target") !== "_blank" ||
          !anchor.getAttribute("rel")?.includes("noopener") ||
          !anchor.getAttribute("rel")?.includes("noreferrer")
        );
      })
      .map((anchor) => anchor.getAttribute("href")),
  );
  expect(malformed).toEqual([]);
  const accessibility = await new AxeBuilder({ page })
    .include(".integrated-analysis")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  await info.attach("native-history-accessibility.json", {
    body: JSON.stringify(accessibility.violations, null, 2),
    contentType: "application/json",
  });
  expect(accessibility.violations).toEqual([]);
  await expect(panel.locator("iframe")).toHaveCount(0);
  await panel.screenshot({ path: `test-results/native-history-timeline-${info.project.name}.png` });
  await toggle.focus();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(modelRequests).toEqual([]);
});

test("native history adapts to mobile and dark theme without horizontal overflow", async ({ page }, info) => {
  const en = info.project.name === "en";
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  const panel = await openAnalysis(page, en);
  const history = panel.locator(".analysis-history");
  const card = history.locator('article[data-history-id="spinal-cord-mri"]');
  await expect(card).toBeVisible();
  const lightColor = await card.evaluate((el) => getComputedStyle(el).color);
  await page.screenshot({
    path: `test-results/native-analysis-workspace-${info.project.name}.png`,
    fullPage: true,
  });
  await panel.screenshot({ path: `test-results/native-history-desktop-light-${info.project.name}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverflow(page);
  await card.locator("button[data-history-toggle]").click();
  await openHistorySection(card, "datasets");
  await expectNoOverflow(page);
  await history.screenshot({ path: `test-results/native-history-mobile-light-${info.project.name}.png` });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).color)).not.toBe(lightColor);
  await expectNoOverflow(page);
  await history.screenshot({ path: `test-results/native-history-mobile-dark-${info.project.name}.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectNoOverflow(page);
  await panel.screenshot({ path: `test-results/native-history-desktop-dark-${info.project.name}.png` });
});

test("unavailable published analysis preserves native history and recovers after retry", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  let fail = true;
  await page.route(
    /\/(?:analysis-bootstrap|data\/analysis-(?:manifest|summary))-v2\.json(?:\?|$)/,
    (route) => (fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue()),
  );
  const panel = await openAnalysis(page, en);
  const run = panel.getByRole("button", { name: en ? "View rule analysis" : "查看规则分析", exact: true });
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(run).toBeDisabled();
  await expect(panel.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  fail = false;
  await panel.getByRole("button", { name: en ? "Retry sources" : "重新载入来源", exact: true }).click();
  await expect(run).toBeEnabled();
  await category(panel, en, false).click();
  await run.click();
  await expect(panel.locator(".integrated-directions article")).toHaveCount(7);
  await panel.screenshot({ path: `test-results/integrated-analysis-${info.project.name}.png` });
});

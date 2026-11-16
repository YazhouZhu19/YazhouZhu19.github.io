import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

// Validate the actual single-file deliverable directly over file:// with all networking disabled.
const file = resolve(process.argv[2] || "../../../OEVRYN-分析-多年积累与证据.html");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
  const page = await context.newPage();
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) external.push(request.url());
  });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() =>
    Boolean((window as Window & { __oevrynOfflineReady?: unknown }).__oevrynOfflineReady),
  );
  assert.equal(await page.locator("#runtime-error").isVisible(), false);
  const stats = await page.locator("#analysis-data").evaluate((el) => {
    const p = JSON.parse(el.textContent!);
    return {
      ...p.paperCodeLinks.stats,
      sufficient: p.result.niches.filter((n: { evidenceStatus: string }) => n.evidenceStatus === "sufficient")
        .length,
      niches: p.result.niches.length,
      historyDirections: p.history?.directions.length ?? 0,
      historySufficient:
        p.history?.directions.filter((d: { evidenceStatus: string }) => d.evidenceStatus === "sufficient")
          .length ?? 0,
      historySample:
        p.history?.directions.find((d: { evidenceStatus: string }) => d.evidenceStatus === "sufficient")
          ?.title ?? p.history?.directions[0]?.title,
    };
  });
  assert.equal(stats.explicitPapers + stats.candidatePapers + stats.unmatchedPapers, stats.papers);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/offline-analysis-desktop.png" });
  await page.locator("#niche-tab").click();
  if (stats.historyDirections) {
    assert.equal(await page.locator("#history-section").isVisible(), true);
    assert.equal(
      await page.locator("#lexical-section").evaluate((el) => (el as HTMLDetailsElement).open),
      false,
    );
    assert.equal(await page.locator("#history-cards article").count(), stats.historyDirections);
    await page.locator("#niche-status").selectOption("sufficient");
    assert.equal(await page.locator("#history-cards article").count(), stats.historySufficient);
    await page.locator("#niche-status").selectOption("pending");
    assert.equal(
      await page.locator("#history-cards article").count(),
      stats.historyDirections - stats.historySufficient,
    );
    await page.locator("#niche-status").selectOption("all");
    await page.locator("#niche-search").fill(stats.historySample);
    assert.ok((await page.locator("#history-cards article").count()) >= 1);
    assert.match(
      await page.locator("#history-cards").innerText(),
      new RegExp(stats.historySample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await page.locator("#niche-search").fill("zz-no-history-987654321");
    assert.equal(await page.locator("#history-cards article").count(), 0);
    await page.locator("#niche-search").fill("");
    await page.locator("#history-count").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/offline-history-desktop.png" });
    const card = page.locator("#history-cards article").first();
    await card.locator(".history-details > summary").click();
    assert.ok((await card.locator(".history-timeline time").count()) > 0);
    const hrefs = await card
      .locator(".history-resources a")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
    assert.ok(hrefs.length > 0);
    assert.ok(hrefs.every((href) => /^https?:\/\//.test(href)));
    await card.locator(".history-resources").locator("h4").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/offline-history-timeline-desktop.png" });
    await card.locator(".history-details > summary").click();
    await page.locator("#lexical-summary").click();
  }
  await page.locator("#niche-status").selectOption("sufficient");
  assert.match(await page.locator("#niche-count").innerText(), new RegExp(`匹配 ${stats.sufficient} 个主题`));
  await page.locator("#niche-status").selectOption("pending");
  assert.match(
    await page.locator("#niche-count").innerText(),
    new RegExp(`匹配 ${stats.niches - stats.sufficient} 个主题`),
  );
  await page.locator("#open-links").click();
  await page.locator("#link-status").selectOption("explicit");
  assert.match(
    await page.locator("#link-count").innerText(),
    new RegExp(`匹配 ${stats.explicitPapers.toLocaleString("zh-CN")} 篇论文`),
  );
  if (stats.explicitPapers)
    assert.match(await page.locator("#link-cards article").first().innerText(), /明确链接/);
  await page.locator("#link-status").selectOption("candidate");
  assert.match(
    await page.locator("#link-count").innerText(),
    new RegExp(`匹配 ${stats.candidatePapers.toLocaleString("zh-CN")} 篇论文`),
  );
  if (stats.candidatePapers) {
    const first = page.locator("#link-cards article").first();
    await first.locator("details > summary").first().click();
    await first.locator(".score-details > summary").first().click();
    assert.match(await first.innerText(), /TF-IDF 余弦 [0-9.]+/);
    assert.match(await first.innerText(), /BM25 [0-9.]+/);
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/offline-associations-desktop.png" });
  }
  await page.locator("#link-search").fill("zz-no-record-oevryn-987654321");
  assert.match(await page.locator("#link-count").innerText(), /匹配 0 篇论文/);
  await page.locator("#link-search").fill("");
  await page.locator("#link-status").selectOption("all");
  if (stats.papers > 12) {
    await page.locator("#link-more").click();
    assert.equal(await page.locator("#link-cards article").count(), Math.min(24, stats.papers));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (stats.historyDirections) {
    await page.locator("#niche-tab").click();
    await page.locator("#niche-status").selectOption(stats.historySufficient ? "sufficient" : "all");
    await page.locator("#history-count").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "Mobile history layout overflows",
    );
    await page.screenshot({ path: "test-results/offline-history-mobile.png" });
    const card = page.locator("#history-cards article").first();
    await card.locator(".history-details > summary").click();
    await card.locator(".history-resources h4").first().scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "Mobile history timeline overflows",
    );
    await page.screenshot({ path: "test-results/offline-history-timeline-mobile.png" });
    await card.locator(".history-details > summary").click();
  }
  await page.locator("#paper-code-section").scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "Mobile association layout overflows",
  );
  await page.locator("#link-status").selectOption("candidate");
  if (stats.candidatePapers) {
    await page.locator("#link-cards article").first().locator("details > summary").first().click();
  }
  await page.locator("#link-cards article").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/offline-associations-mobile.png" });
  await page.locator("#niche-tab").scrollIntoViewIfNeeded();
  await page.locator("#niche-tab").click();
  await page.locator("#niche-status").selectOption("pending");
  await page.locator("#niche-cards article").first().scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "Mobile niche layout overflows",
  );
  await page.screenshot({ path: "test-results/offline-niches-mobile.png" });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify(
      {
        file,
        stats,
        desktop: true,
        mobile: true,
        networkRequests: external.length,
        pageErrors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

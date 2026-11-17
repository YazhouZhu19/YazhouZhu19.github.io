import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// node scripts/check-analysis-network.mjs [base URL] [output JSON] [samples 1..20] [label]
// This records real public-network variation; no timing threshold is a pass/fail gate.
const args = process.argv.slice(2);
if (args[0] === "--help") {
  console.log(
    "Usage: node scripts/check-analysis-network.mjs [base URL] [output JSON] [samples 1..20] [label]",
  );
  process.exit(0);
}
assert.ok(args.length <= 4, "Expected URL, output path, sample count and optional label");
const count = Number(args[2] ?? 5);
assert.ok(
  Number.isSafeInteger(count) && count >= 1 && count <= 20,
  "Sample count must be an integer from 1 to 20",
);
function baseUrl(value) {
  const url = new URL(value);
  assert.ok(["http:", "https:"].includes(url.protocol), "Expected an HTTP(S) base URL");
  assert.ok(!url.username && !url.password, "Base URL must not contain credentials");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
const target = baseUrl(args[0] ?? "https://yazhouzhu19.github.io/research-monitor/");
const base = target.href;
const output = args[1] ?? join(tmpdir(), "oevryn-analysis-network.json");
const label = args[3] ?? "public-network";
const rootBase = new URL(target.pathname.endsWith("/en/") ? "../" : "./", target).href;
const english = target.pathname.endsWith("/en/");
const starts = new Date().toISOString();
async function deployment(root) {
  const url = new URL("deployment.json", root);
  url.searchParams.set("profile", String(Date.now()));
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, `Deployment metadata failed: ${response.status} ${url}`);
  const result = await response.json();
  assert.ok(
    typeof result.sourceRevision === "string" && result.sourceRevision.length > 0,
    "Missing deployment source revision",
  );
  assert.match(
    result.analysisContentSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Missing deployment semantic fingerprint",
  );
  return result;
}
async function publications() {
  const web = await deployment(rootBase);
  const dataBaseUrl = baseUrl(web.dataBaseUrl ?? rootBase).href;
  const data = dataBaseUrl === rootBase ? web : await deployment(dataBaseUrl);
  return {
    web,
    data,
    dataBaseUrl,
    sameSemanticContent: web.analysisContentSha256 === data.analysisContentSha256,
  };
}
const publicationBefore = await publications();
const browser = await chromium.launch();
const runs = [];
let resultSignature;
function summarize() {
  const mid = (values) => {
    values = values.filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  const median = (key) => mid(runs.map((r) => r.marks[key]));
  const afterDocument = (key) => mid(runs.map((r) => r.marks[key] - r.documentMs));
  return {
    label,
    base,
    startedAt: starts,
    measurement:
      "Real public network; no request interception and no latency/bandwidth emulation. Fresh cold Chromium context per sample; same browser process. Observer measures DOM milestones, nested requestAnimationFrame measures the following paint opportunity (not a pixel-presentation timestamp).",
    publicationBefore,
    sampleCount: runs.length,
    median: {
      historyDomMs: median("historyDomMs"),
      historyPaintOpportunityMs: median("historyPaintOpportunityMs"),
      readyDomMs: median("readyDomMs"),
      readyPaintOpportunityMs: median("readyPaintOpportunityMs"),
      historyDomMsAfterDocument: afterDocument("historyDomMs"),
      historyPaintOpportunityMsAfterDocument: afterDocument("historyPaintOpportunityMs"),
      readyDomMsAfterDocument: afterDocument("readyDomMs"),
      readyPaintOpportunityMsAfterDocument: afterDocument("readyPaintOpportunityMs"),
      navTtfbMs: mid(runs.map((r) => r.navTtfbMs)),
      documentMs: mid(runs.map((r) => r.documentMs)),
    },
    runs,
  };
}
try {
  for (let sample = 1; sample <= count; sample++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: english ? "en-US" : "zh-CN",
      colorScheme: "light",
      serviceWorkers: "block",
    });
    await context.addInitScript(
      ({ english }) => {
        const marks = {};
        window.__oevrynMetrics = { marks, visibility: document.visibilityState };
        const visible = (element) => {
          if (
            !element ||
            element.getClientRects().length === 0 ||
            getComputedStyle(element).visibility === "hidden"
          )
            return false;
          const box = element.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
        };
        const record = (name, element) => {
          if (marks[name + "DomMs"] !== undefined) return;
          marks[name + "DomMs"] = performance.now();
          requestAnimationFrame(() => {
            marks[name + "FirstRafMs"] = performance.now();
            if (visible(element)) marks[name + "LayoutMs"] = performance.now();
            requestAnimationFrame(() => {
              marks[name + "PaintOpportunityMs"] = performance.now();
            });
          });
        };
        const inspect = () => {
          const cards = document.querySelectorAll(
            ".integrated-analysis .analysis-history article[data-history-id]",
          );
          if (cards.length === 3) record("history", cards[0]);
          const button = [...document.querySelectorAll(".integrated-analysis button")].find(
            (node) => node.textContent.trim() === (english ? "View rule analysis" : "查看规则分析"),
          );
          if (button && !button.disabled) record("ready", button);
          if (marks.historyDomMs !== undefined && marks.readyDomMs !== undefined) observer.disconnect();
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["disabled", "class", "style"],
        });
        inspect();
      },
      { english },
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const requests = [],
      errors = [],
      responses = [],
      loading = [],
      priorities = [];
    cdp.on("Network.requestWillBeSent", (event) =>
      priorities.push({
        id: event.requestId,
        url: event.request.url,
        priority: event.request.initialPriority,
        type: event.type,
        timestamp: event.timestamp,
      }),
    );
    cdp.on("Network.resourceChangedPriority", (event) =>
      priorities.push({ id: event.requestId, priority: event.newPriority, timestamp: event.timestamp }),
    );
    context.on("request", (request) =>
      requests.push({ url: request.url(), type: request.resourceType(), method: request.method() }),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    cdp.on("Network.responseReceived", (event) =>
      responses.push({
        id: event.requestId,
        url: event.response.url,
        status: event.response.status,
        protocol: event.response.protocol,
        fromDiskCache: event.response.fromDiskCache,
        fromServiceWorker: event.response.fromServiceWorker,
        timing: event.response.timing,
        headers: {
          contentType: event.response.mimeType,
          contentEncoding:
            event.response.headers["content-encoding"] || event.response.headers["Content-Encoding"],
        },
      }),
    );
    cdp.on("Network.loadingFinished", (event) =>
      loading.push({ id: event.requestId, encodedDataLength: event.encodedDataLength }),
    );
    await page.goto(base + "?profile=" + Date.now() + "-" + sample + "#/analysis", {
      waitUntil: "commit",
      timeout: 90000,
    });
    await page.waitForFunction(
      () =>
        window.__oevrynMetrics?.marks.historyPaintOpportunityMs !== undefined &&
        window.__oevrynMetrics?.marks.readyPaintOpportunityMs !== undefined,
      {},
      { timeout: 90000 },
    );
    await page.waitForLoadState("networkidle", { timeout: 90000 });
    const metrics = await page.evaluate(() => ({
      marks: window.__oevrynMetrics.marks,
      visibility: document.visibilityState,
      navigation: performance.getEntriesByType("navigation").map((e) => e.toJSON()),
      paint: performance.getEntriesByType("paint").map((e) => e.toJSON()),
      resources: performance.getEntriesByType("resource").map((e) => ({
        url: e.name,
        type: e.initiatorType,
        start: e.startTime,
        requestStart: e.requestStart,
        responseStart: e.responseStart,
        end: e.responseEnd,
        duration: e.duration,
        transfer: e.transferSize,
        encoded: e.encodedBodySize,
        decoded: e.decodedBodySize,
        protocol: e.nextHopProtocol,
      })),
    }));
    const startupRequests = [...requests];
    await page
      .getByRole("button", { name: english ? "Mainstream directions" : "主流研究方向", exact: true })
      .click();
    await page
      .getByRole("button", { name: english ? "View rule analysis" : "查看规则分析", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".integrated-directions > article").length === 7,
    );
    const result = await page.locator(".integrated-analysis").evaluate((el) => ({
      counts: [...el.querySelectorAll(".integrated-counts strong")].map((n) => n.textContent),
      directions: [...el.querySelectorAll(".integrated-directions > article")].map((n) => ({
        label: n.querySelector("h3")?.textContent,
        score: n.querySelector(".integrated-score strong")?.textContent,
      })),
    }));
    resultSignature ??= result;
    assert.deepEqual(result, resultSignature, "Rendered results changed between samples");
    const resourceUrls = metrics.resources.map((r) => r.url);
    const duplicateResources = [
      ...new Set(resourceUrls.filter((url, index) => resourceUrls.indexOf(url) !== index)),
    ];
    const fullSources = startupRequests.filter((r) =>
      /\/data\/(?:public-papers|papers(?:\.json|\/)|paper-overview|research-signals|signals-v2\/)/.test(
        r.url,
      ),
    );
    const models = startupRequests.filter((r) => /ai-worker|webllm|web-llm|\/assets\/lib-/.test(r.url));
    const deferredModules = startupRequests.filter((r) =>
      /\/assets\/(?:notification-host|sonner|select|paper-code-links|research-dashboard)-[^/]+\.js(?:\?|$)/.test(
        r.url,
      ),
    );
    const dataRequests = startupRequests.filter((r) =>
      /analysis-(?:bootstrap|manifest|summary)(?:-v\d+)?\.json/.test(r.url),
    );
    assert.deepEqual(fullSources, []);
    assert.deepEqual(models, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(duplicateResources, []);
    assert.deepEqual(deferredModules, []);
    const row = {
      sample,
      marks: metrics.marks,
      visibility: metrics.visibility,
      navTtfbMs: metrics.navigation[0].responseStart,
      documentMs: metrics.navigation[0].responseEnd,
      requestCount: startupRequests.length,
      dataRequestCount: dataRequests.length,
      transferBytes: metrics.resources.reduce((sum, r) => sum + r.transfer, 0),
      encodedBytes: metrics.resources.reduce((sum, r) => sum + r.encoded, 0),
      duplicateResources,
      fullSources,
      models,
      deferredModules,
      errors,
      result,
      ...metrics,
      requests: startupRequests,
      responses,
      loading,
      priorities,
    };
    runs.push(row);
    await writeFile(output, JSON.stringify(summarize(), null, 2) + "\n");
    console.log(
      JSON.stringify({
        label,
        sample,
        marks: row.marks,
        navTtfbMs: row.navTtfbMs,
        documentMs: row.documentMs,
        requests: row.requestCount,
        dataRequests: row.dataRequestCount,
        transferBytes: row.transferBytes,
        errors: row.errors,
      }),
    );
    await context.close();
  }
  const publicationAfter = await publications();
  const identity = (publication) => ({
    dataBaseUrl: publication.dataBaseUrl,
    web: {
      sourceRevision: publication.web.sourceRevision,
      contentSha256: publication.web.analysisContentSha256,
      snapshotSha256: publication.web.analysisSnapshotV2Sha256,
    },
    data: {
      sourceRevision: publication.data.sourceRevision,
      contentSha256: publication.data.analysisContentSha256,
      snapshotSha256: publication.data.analysisSnapshotV2Sha256,
    },
  });
  const publicationStable =
    JSON.stringify(identity(publicationBefore)) === JSON.stringify(identity(publicationAfter));
  const report = {
    ...summarize(),
    publicationAfter,
    publicationStable,
    completedAt: new Date().toISOString(),
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  assert.equal(
    publicationStable,
    true,
    "Web/data publication source or fingerprint changed during measurement; rerun before comparing timings",
  );
  console.log(
    JSON.stringify({
      output,
      median: report.median,
      publicationStable,
      webRevision: publicationAfter.web.sourceRevision,
      dataRevision: publicationAfter.data.sourceRevision,
    }),
  );
} finally {
  await browser.close();
}

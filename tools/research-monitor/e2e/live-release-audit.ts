import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Browser, Page } from "@playwright/test";
import {
  parseAnalysisTransport,
  parseAnalysisManifestV2,
  stableAnalysisContent,
} from "../lib/analysis-transport.ts";
import {
  parseAnalysisSnapshot,
  parseAnalysisManifest,
  type AnalysisSnapshot,
} from "../lib/analysis-snapshot.ts";
import { parseSnapshotManifest, resolveSnapshot } from "../lib/snapshot.ts";
import {
  parseSignalsManifest,
  resolveSignalKind,
  signalSnapshotData,
} from "../lib/signals-snapshot.ts";
import { monitorDataSchema } from "../lib/public-data-schema.ts";
import { createAnalysisSnapshot } from "../scripts/analysis-snapshot.ts";
import type { LongitudinalHistory } from "../lib/longitudinal-analysis.ts";

const { chromium, expect, request }: typeof import("@playwright/test") =
  createRequire(import.meta.url)("@playwright/test");

if (process.argv.includes("--help")) {
  console.log(
    "Usage: node --import tsx e2e/live-release-audit.ts WEB_SOURCE_SHA DATA_SOURCE_SHA [EXPECTED_DATA_DEPLOYMENT_JSON]",
  );
  console.log(
    "Requires full 40-character source revisions. Optional JSON is the exact expected data deployment.json. Downloads and verifies all active public shards, recomputes complete rule analysis, then tests real browser flows. Outputs online-verification.json and screenshots to OEVRYN_AUDIT_DIR (default ./live-audit). No legacy counts are pinned.",
  );
  process.exit(0);
}

type Locale = "zh" | "en";
type Theme = "light" | "dark";
type Source = "github" | "news";
type Deployment = {
  schemaVersion: number;
  sourceRevision: string;
  runId: string;
  paperCount: number;
  signalCount: number;
  collectedAt: string;
  signalsGeneratedAt: string;
  compactPapersSha256: string;
  paperOverviewSha256: string;
  signalsManifestSha256: string;
  analysisSnapshotSha256: string;
  analysisManifestSha256: string;
  analysisSnapshotV2Sha256: string;
  analysisManifestV2Sha256: string;
  analysisContentSha256: string;
  role?: string;
  dataBaseUrl?: string;
};
const [expectedWeb, expectedData, expectedDataFile] = process.argv.slice(2);
assert.match(
  expectedWeb ?? "",
  /^[a-f0-9]{40}$/,
  "WEB_SOURCE_SHA must be a full source commit",
);
assert.match(
  expectedData ?? "",
  /^[a-f0-9]{40}$/,
  "DATA_SOURCE_SHA must be a full source commit, not a Pages deployment commit",
);
const resourceBudget = JSON.parse(
  await readFile(join(process.cwd(), "budget.json"), "utf8"),
);
const overviewMaxBytes: number =
  resourceBudget.limits.datasets["paper-overview"].fileRawBytes;
assert.ok(Number.isSafeInteger(overviewMaxBytes) && overviewMaxBytes > 0);
const out = process.env.OEVRYN_AUDIT_DIR || join(process.cwd(), "live-audit");
const webBase = "https://yazhouzhu19.github.io/research-monitor/";
const dataBase = "https://yazhouzhu19.github.io/oevryn-data/";
const reportPath = join(out, "online-verification.json");
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const number = (value: number) => value.toLocaleString("en-US");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const browserCases: Record<string, unknown>[] = [];
const verifiedShards: Record<string, unknown>[] = [];
const filterMeasurements: Record<string, unknown>[] = [];
const downloads: Record<string, unknown>[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  expectedWeb,
  expectedData,
  expectedDataFile,
  stage: "deployment",
  passed: false,
  downloads,
  verifiedShards,
  browserCases,
  filterMeasurements,
  scope:
    "Real public network; all active paper/signal shards; full deterministic rule analysis; no model execution",
};
await mkdir(out, { recursive: true });
const save = () =>
  writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
const stage = async (name: string) => {
  report.stage = name;
  console.log(JSON.stringify({ stage: name, at: new Date().toISOString() }));
  await save();
};
const api = await request.newContext({ timeout: 45000 });
let browser: Browser | undefined;

function deployment(
  raw: unknown,
  expected: string,
  role: "web" | "data",
): Deployment {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
  const value = raw as Deployment;
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.sourceRevision, expected, `${role} revision differs`);
  for (const count of [value.paperCount, value.signalCount])
    assert.ok(Number.isSafeInteger(count) && count >= 0);
  for (const date of [value.collectedAt, value.signalsGeneratedAt])
    assert.ok(Number.isFinite(Date.parse(date)));
  for (const key of [
    "compactPapersSha256",
    "paperOverviewSha256",
    "signalsManifestSha256",
    "analysisSnapshotSha256",
    "analysisManifestSha256",
    "analysisSnapshotV2Sha256",
    "analysisManifestV2Sha256",
    "analysisContentSha256",
  ] as const)
    assert.match(value[key], /^[a-f0-9]{64}$/, `${role}.${key}`);
  if (role === "web") {
    assert.equal(value.role, "web");
    assert.equal(value.dataBaseUrl, dataBase);
  } else assert.ok(value.role === undefined || value.role === "data");
  return value;
}

async function get(url: string, maxBytes = 8 * 1024 * 1024, fresh = false) {
  const target = new URL(url);
  if (fresh) target.searchParams.set("release-verify", String(Date.now()));
  const started = performance.now();
  const response = await api.get(target.href);
  try {
    assert.equal(
      response.status(),
      200,
      `${target.href}: HTTP ${response.status()}`,
    );
    const buffer = await response.body();
    assert.ok(
      buffer.length > 0 && buffer.length <= maxBytes,
      `${url}: body exceeds ${maxBytes} bytes`,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const result = { text, bytes: buffer.length, sha256: hash(buffer) };
    downloads.push({
      url: target.href,
      bytes: result.bytes,
      sha256: result.sha256,
      ms: Math.round(performance.now() - started),
    });
    return result;
  } finally {
    await response.dispose(); // The full archive must not remain retained by APIResponse objects.
  }
}
async function getJson(url: string, fresh = false, maxBytes?: number) {
  const response = await get(url, maxBytes, fresh);
  return { ...response, value: JSON.parse(response.text) as unknown };
}
function verifySnapshot(snapshot: AnalysisSnapshot, meta: Deployment) {
  assert.equal(
    hash(stableAnalysisContent(snapshot)),
    meta.analysisContentSha256,
    "Full analysis semantics hash differs",
  );
  assert.deepEqual(snapshot.sources.papers, {
    collectedAt: meta.collectedAt,
    totalStored: meta.paperCount,
    manifestSha256: meta.compactPapersSha256,
  });
  assert.equal(snapshot.sources.signals.generatedAt, meta.signalsGeneratedAt);
  assert.equal(snapshot.sources.signals.totalStored, meta.signalCount);
  assert.equal(
    snapshot.sources.signals.manifestSha256,
    meta.signalsManifestSha256,
  );
}

async function appearance(page: Page, theme: Theme) {
  await expect(page.locator(".page-heading h1")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const value = await page.evaluate(() => {
    const body = getComputedStyle(document.body),
      root = getComputedStyle(document.documentElement);
    const heading = getComputedStyle(document.querySelector(".page-heading")!);
    const title = getComputedStyle(document.querySelector(".page-heading h1")!);
    return {
      bodyFont: body.fontFamily,
      headingFont: title.fontFamily,
      headingWeight: title.fontWeight,
      background: body.backgroundColor,
      foreground: body.color,
      primary: root.getPropertyValue("--primary").trim(),
      headingRadius: heading.borderRadius,
      headingShadow: heading.boxShadow,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  for (const font of [value.bodyFont, value.headingFont]) {
    assert.match(font, /Georgia/);
    assert.match(font, /Songti SC/);
    assert.match(font, /,\s*serif$/);
  }
  assert.equal(value.headingWeight, "450");
  assert.equal(
    value.background,
    theme === "light" ? "rgb(249, 249, 248)" : "rgb(17, 17, 16)",
  );
  assert.equal(
    value.foreground,
    theme === "light" ? "rgb(33, 32, 28)" : "rgb(238, 238, 236)",
  );
  assert.equal(value.primary, theme === "light" ? "#2c5d48" : "#61d0b4");
  assert.equal(value.headingRadius, "0px");
  assert.equal(value.headingShadow, "none");
  assert.ok(
    value.scrollWidth <= value.width + 1,
    `Horizontal overflow: ${JSON.stringify(value)}`,
  );
  return value;
}
async function measureFilterLayout(
  page: Page,
  source: Source,
  counts: Record<Source, number>,
) {
  const root = page.locator(`.${source}-signals`);
  await expect(root.locator(`.${source}-dashboard-summary`)).toBeVisible({
    timeout: 120000,
  });
  await expect(
    root.locator(".signals-dashboard-tabs button").nth(1).locator("span"),
  ).toHaveText(number(counts[source]), { timeout: 120000 });
  const search = root.locator(".source-search-controls");
  if ((await search.getAttribute("open")) === null)
    await search.locator("summary").click();
  await expect(search.locator("input")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const layout = await root.evaluate((element) => {
    // Inline callbacks avoid tsx's Node-side name helper leaking into browser evaluation.
    const [primary, search] = [
      ".source-filter-toolbar",
      ".source-search-controls .signals-filter-toolbar",
    ].map((selector, index) => {
      const fixedFilters = index === 0;
      const grid = element.querySelector(selector)!,
        bounds = grid.getBoundingClientRect();
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        width: Math.round(bounds.width * 10) / 10,
        // The recordsLoaded-dependent comparison CTA may add a row; compare
        // only the four stable filters, retaining full search geometry below.
        ...(!fixedFilters
          ? { height: Math.round(bounds.height * 10) / 10 }
          : {}),
        controls: (fixedFilters
          ? [...grid.querySelectorAll(":scope > .dash-control")]
          : [...grid.children]
        ).map((child) => {
          const box = child.getBoundingClientRect();
          return {
            x: Math.round((box.x - bounds.x) * 10) / 10,
            y: Math.round((box.y - bounds.y) * 10) / 10,
            width: Math.round(box.width * 10) / 10,
            height: Math.round(box.height * 10) / 10,
          };
        }),
      };
    });
    const control = getComputedStyle(
      element.querySelector(".signals-filters select")!,
    );
    return {
      primary,
      search,
      values: [
        ...element.querySelectorAll<HTMLSelectElement>(
          ".signals-filters select",
        ),
      ].map((s) => s.value),
      query: element.querySelector<HTMLInputElement>(
        ".source-search-controls input",
      )!.value,
      controlFont: control.fontFamily,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
  const width = page.viewportSize()!.width;
  assert.equal(layout.primary.columns, width > 1200 ? 5 : 2);
  assert.equal(layout.primary.controls.length, 4);
  assert.equal(layout.search.columns, width > 600 ? 2 : 1);
  assert.ok(layout.overflow <= 1);
  assert.match(layout.controlFont, /Georgia/);
  assert.match(layout.controlFont, /Songti SC/);
  for (const grid of [layout.primary, layout.search])
    for (const control of grid.controls)
      assert.ok(
        control.x >= -1 && control.x + control.width <= grid.width + 1,
        "A filter control escapes its grid",
      );
  return layout;
}
async function filterLayout(
  page: Page,
  source: Source,
  counts: Record<Source, number>,
) {
  // Keep cold-start assertions before requesting complete records. The auto CTA
  // track legitimately changes width with loading text; compare equal loaded states.
  const initial = await measureFilterLayout(page, source, counts);
  const root = page.locator(`.${source}-signals`);
  const initialButtons = await root
    .locator(".source-filter-toolbar > button")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        disabled: (node as HTMLButtonElement).disabled,
      })),
    );
  const measurement: Record<string, unknown> = {
    case: browserCases.at(-1)?.name,
    source,
    initial,
    initialButtons,
  };
  filterMeasurements.push(measurement);
  console.log(
    JSON.stringify({
      case: measurement.case,
      source,
      phase: "initial-filter-layout",
      buttons: initialButtons,
    }),
  );
  await save();
  const compare = root.locator(".source-filter-toolbar > button").filter({
    hasText:
      /比较相邻时间窗|正在准备窗口比较|Compare adjacent windows|Preparing window comparison/,
  });
  if (await compare.count()) {
    // Verified cached records can finish automatically while this CTA is disabled.
    // Accept either an enabled action or its removal, then require the loaded state.
    await expect
      .poll(
        () =>
          compare.evaluateAll(
            (nodes) =>
              nodes.length === 0 ||
              nodes.every((node) => !(node as HTMLButtonElement).disabled),
          ),
        { timeout: 120000 },
      )
      .toBe(true);
    // A re-render can replace the bound button before the click. Rebind at most
    // three times; a disappeared CTA counts as completion only in the loaded view.
    let actionCompleted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [button] = await compare.elementHandles();
      if (!button) {
        await expect(
          root
            .locator(".signals-view-content > .signals-filter-hint")
            .filter({ hasText: /总览截至|Overview as of/ }),
        ).toHaveCount(0);
        measurement.loadedBeforeClick = true;
        actionCompleted = true;
        break;
      }
      try {
        if (!(await button.evaluate((node) => node.isConnected))) {
          if (!(await compare.count())) {
            await expect(
              root
                .locator(".signals-view-content > .signals-filter-hint")
                .filter({ hasText: /总览截至|Overview as of/ }),
            ).toHaveCount(0);
            measurement.loadedBeforeClick = true;
            actionCompleted = true;
            break;
          }
          continue;
        }
        await button.click({ timeout: 5000 });
        measurement.clickAttempt = attempt + 1;
        actionCompleted = true;
        break;
      } catch (error) {
        if (!(await compare.count())) {
          await expect(
            root
              .locator(".signals-view-content > .signals-filter-hint")
              .filter({ hasText: /总览截至|Overview as of/ }),
          ).toHaveCount(0);
          measurement.loadedBeforeClick = true;
          actionCompleted = true;
          break;
        }
        if (!(await button.evaluate((node) => node.isConnected))) continue;
        throw error;
      } finally {
        await button.dispose();
      }
    }
    assert.equal(
      actionCompleted,
      true,
      "Comparison button was replaced during all three binding attempts",
    );
    await expect(compare).toHaveCount(0, { timeout: 120000 });
  }
  await expect(
    root.locator(".signals-dashboard-tabs button").first(),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    root
      .locator(".signals-view-content > .signals-filter-hint")
      .filter({ hasText: /总览截至|Overview as of/ }),
  ).toHaveCount(0);
  const ready = await measureFilterLayout(page, source, counts);
  assert.deepEqual(
    ready.values,
    initial.values,
    "Loading records changed filter values",
  );
  assert.equal(
    ready.query,
    initial.query,
    "Loading records changed the search query",
  );
  measurement.ready = ready;
  measurement.readyButtons = await root
    .locator(".source-filter-toolbar > button")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        disabled: (node as HTMLButtonElement).disabled,
      })),
    );
  console.log(
    JSON.stringify({
      case: measurement.case,
      source,
      phase: "loaded-filter-layout",
    }),
  );
  await save();
  return ready;
}
async function navigate(page: Page, source: Source, locale: Locale) {
  const label =
    source === "github"
      ? locale === "en"
        ? "Open-source insights"
        : "开源洞察"
      : locale === "en"
        ? "Frontier updates"
        : "前沿动态";
  const desktop = page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: label, exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
}
const pageUrl = (locale: Locale, route: string) =>
  webBase +
  (locale === "en" ? "en/" : "") +
  (route === "papers" ? "" : `#/${route}`);

async function monitoredCase(
  name: string,
  locale: Locale,
  theme: Theme,
  width: number,
  run: (
    page: Page,
    item: Record<string, unknown>,
    context: Awaited<ReturnType<Browser["newContext"]>>,
    observedAnalysis: string[],
  ) => Promise<void>,
) {
  assert.ok(browser);
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
    locale: locale === "en" ? "en-US" : "zh-CN",
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const errors: string[] = [],
    forbidden: string[] = [],
    httpErrors: unknown[] = [],
    failed: unknown[] = [],
    cancelled: unknown[] = [];
  const observedAnalysis: string[] = [];
  const pending = new Set<Promise<void>>();
  const item: Record<string, unknown> = {
    name,
    locale,
    theme,
    width,
    errors,
    forbidden,
    httpErrors,
    failed,
    cancelled,
    observedAnalysis,
    passed: false,
  };
  browserCases.push(item);
  // Only forbidden downloads are blocked. Every permitted document, script and data response is live network traffic.
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (
      req.resourceType() === "font" ||
      /fonts\.(?:googleapis|gstatic)\.com|ai-worker|web-?llm|mlc-ai|\/assets\/lib-|api\.openai\.com|anthropic|\.gguf(?:$|\?)|\.safetensors(?:$|\?)|params_shard\d+\.bin/i.test(
        req.url(),
      )
    ) {
      forbidden.push(req.url());
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  context.on("page", (page) => {
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => errors.push(e.message));
  });
  context.on("requestfailed", (req) => {
    const entry = { url: req.url(), error: req.failure()?.errorText };
    if (entry.error === "net::ERR_ABORTED")
      cancelled.push(entry); // Switching sources intentionally cancels obsolete fetches.
    else failed.push(entry);
  });
  context.on("response", (response) => {
    if (response.status() >= 400)
      httpErrors.push({ url: response.url(), status: response.status() });
    if (
      response.status() === 200 &&
      /\/(?:analysis-summary-v2|analysis-bootstrap-v2)\.json(?:\?|$)/.test(
        response.url(),
      )
    ) {
      const inspection = (async () => {
        try {
          observedAnalysis.push(
            hash(
              stableAnalysisContent(
                parseAnalysisTransport(await response.json()),
              ),
            ),
          );
        } catch (error) {
          errors.push(
            `Analysis response could not be verified: ${String(error)}`,
          );
        }
      })();
      pending.add(inspection);
      void inspection.finally(() => pending.delete(inspection));
    }
  });
  try {
    const page = await context.newPage();
    await run(page, item, context, observedAnalysis);
    await Promise.all([...pending]);
    assert.deepEqual(errors, [], name);
    assert.deepEqual(
      forbidden,
      [],
      "No model or external font download may be attempted",
    );
    assert.deepEqual(httpErrors, [], name);
    assert.deepEqual(failed, [], name);
    item.passed = true;
    console.log(JSON.stringify({ case: name, passed: true }));
  } finally {
    await context.close();
    await save();
  }
}

try {
  const [webResponse, dataResponse] = await Promise.all([
    getJson(webBase + "deployment.json", true),
    getJson(dataBase + "deployment.json", true),
  ]);
  const web = deployment(webResponse.value, expectedWeb, "web"),
    data = deployment(dataResponse.value, expectedData, "data");
  if (expectedDataFile)
    assert.deepEqual(
      data,
      JSON.parse(await readFile(expectedDataFile, "utf8")),
      "Published data metadata differs from the supplied deployment artifact",
    );
  report.web = web;
  report.data = data;
  await stage("verify-public-manifests-and-analysis");
  const [
    paperResponse,
    overviewResponse,
    signalResponse,
    v1Response,
    manifest1Response,
    v2Response,
    manifest2Response,
    bootstrapResponse,
    bootstrapManifestResponse,
  ] = await Promise.all([
    getJson(dataBase + "data/public-papers-v3.json", true, 4 * 1024 * 1024),
    // The overview is a full index, not an 8 MiB analysis snapshot. Its exact
    // deployment hash is still required below; keep a separate bounded read.
    getJson(dataBase + "data/paper-overview.json", true, overviewMaxBytes),
    getJson(dataBase + "data/signals-v2/manifest.json", true, 4 * 1024 * 1024),
    getJson(dataBase + "data/analysis-summary.json", true),
    getJson(dataBase + "data/analysis-manifest.json", true),
    getJson(dataBase + "data/analysis-summary-v2.json", true),
    getJson(dataBase + "data/analysis-manifest-v2.json", true),
    getJson(webBase + "analysis-bootstrap-v2.json", true),
    getJson(webBase + "analysis-bootstrap-manifest-v2.json", true),
  ]);
  for (const [response, expected, label] of [
    [paperResponse, data.compactPapersSha256, "papers"],
    [overviewResponse, data.paperOverviewSha256, "overview"],
    [signalResponse, data.signalsManifestSha256, "signals"],
    [v1Response, data.analysisSnapshotSha256, "analysis-v1"],
    [manifest1Response, data.analysisManifestSha256, "analysis-manifest-v1"],
    [v2Response, data.analysisSnapshotV2Sha256, "analysis-v2"],
    [manifest2Response, data.analysisManifestV2Sha256, "analysis-manifest-v2"],
    [bootstrapResponse, web.analysisSnapshotV2Sha256, "web-bootstrap"],
    [
      bootstrapManifestResponse,
      web.analysisManifestV2Sha256,
      "web-bootstrap-manifest",
    ],
  ] as const)
    assert.equal(
      response.sha256,
      expected,
      `${label} hash differs from deployment metadata`,
    );
  const papers = parseSnapshotManifest(paperResponse.value),
    signals = parseSignalsManifest(signalResponse.value, signalResponse.bytes);
  const analysis = parseAnalysisTransport(v2Response.value),
    v1 = parseAnalysisSnapshot(v1Response.value);
  const manifest1 = parseAnalysisManifest(manifest1Response.value),
    manifest2 = parseAnalysisManifestV2(manifest2Response.value);
  const bootstrap = parseAnalysisTransport(bootstrapResponse.value),
    bootstrapManifest = parseAnalysisManifestV2(
      bootstrapManifestResponse.value,
    );
  assert.deepEqual(
    analysis,
    v1,
    "Packed and unpacked analysis differ in complete semantics",
  );
  verifySnapshot(analysis, data);
  verifySnapshot(bootstrap, web);
  for (const [manifest, response, snapshot, meta] of [
    [manifest1, v1Response, v1, data],
    [manifest2, v2Response, analysis, data],
    [bootstrapManifest, bootstrapResponse, bootstrap, web],
  ] as const) {
    assert.equal(manifest.snapshotSha256, response.sha256);
    assert.equal(manifest.snapshotBytes, response.bytes);
    assert.equal(manifest.generatedAt, snapshot.generatedAt);
    assert.equal(manifest.asOf, snapshot.result.asOf);
    assert.equal(manifest.ruleVersion, snapshot.result.version);
    assert.deepEqual(manifest.sources.papers, snapshot.sources.papers);
    const { states: _states, ...signalSources } = snapshot.sources.signals;
    assert.deepEqual(manifest.sources.signals, signalSources);
    if ("contentSha256" in manifest)
      assert.equal(manifest.contentSha256, meta.analysisContentSha256);
  }
  assert.equal(papers.totalStored, data.paperCount);
  assert.equal(papers.metadata.collectedAt, data.collectedAt);
  assert.equal(signals.counts.github + signals.counts.news, data.signalCount);
  assert.equal(signals.generatedAt, data.signalsGeneratedAt);
  assert.deepEqual(signals.sources, analysis.sources.signals.states);
  report.analysis = {
    totals: analysis.result.totals,
    asOf: analysis.result.asOf,
    directionCount: analysis.result.directions.length,
    nicheCount: analysis.result.niches.length,
    semanticSha256: data.analysisContentSha256,
  };

  await stage("verify-all-active-shards-and-recompute-complete-analysis");
  async function readShard(
    base: string,
    path: string,
    descriptor: { bytes: number; sha256: string; count: number },
    kind: string,
  ) {
    const url = new URL(path, base).href;
    assert.ok(
      url.startsWith(dataBase + "data/"),
      "Shard path escapes the public data root",
    );
    const response = await get(url, 4 * 1024 * 1024);
    assert.equal(response.bytes, descriptor.bytes, `${path}: byte count`);
    assert.equal(response.sha256, descriptor.sha256, `${path}: SHA256`);
    verifiedShards.push({
      kind,
      path,
      sha256: response.sha256,
      bytes: response.bytes,
      records: descriptor.count,
    });
    if (verifiedShards.length % 10 === 0) {
      console.log(JSON.stringify({ verifiedShards: verifiedShards.length }));
      await save();
    }
    return response.text;
  }
  const paperByPath = new Map(
    papers.shards.map((shard) => [shard.path, shard]),
  );
  const completePapers = await resolveSnapshot(papers, (path) =>
    readShard(
      dataBase + "data/public-papers-v3.json",
      path,
      paperByPath.get(path)!,
      "paper",
    ),
  );
  monitorDataSchema.parse(completePapers);
  const github = await resolveSignalKind(signals, "github", (shard) =>
    readShard(
      dataBase + "data/signals-v2/manifest.json",
      shard.path,
      shard,
      "github",
    ),
  );
  const news = await resolveSignalKind(signals, "news", (shard) =>
    readShard(
      dataBase + "data/signals-v2/manifest.json",
      shard.path,
      shard,
      "news",
    ),
  );
  const completeSignals = signalSnapshotData(
    signals,
    [...github, ...news].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.equal(completePapers.papers.length, data.paperCount);
  assert.equal(completeSignals.records.length, data.signalCount);
  // Match the publication reference day rather than the verifier's wall clock.
  assert.equal(
    new Date(analysis.generatedAt).toISOString().slice(0, 10),
    analysis.result.asOf,
  );
  const recomputed = createAnalysisSnapshot({
    papers: completePapers,
    signals: completeSignals,
    generatedAt: analysis.generatedAt,
    paperManifestSha256: paperResponse.sha256,
    signalsManifestSha256: signalResponse.sha256,
  });
  assert.deepEqual(
    recomputed,
    analysis,
    "Complete recomputed rules/evidence/denominators/niches differ from the published analysis",
  );
  report.fullDataVerified = {
    paperCount: completePapers.papers.length,
    signalCount: completeSignals.records.length,
    activeShards: verifiedShards.length,
    allShardsHashBytesCountVerified: true,
    duplicateAndSourceValidationPassed: true,
    completeAnalysisRecomputedEqual: true,
  };

  await stage("real-browser-navigation-and-analysis");
  browser = await chromium.launch({ headless: true });
  for (const locale of ["zh", "en"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [1440, 390]) {
        await monitoredCase(
          `source-order-${locale}-${width}-${theme}`,
          locale,
          theme,
          width,
          async (page, item, context) => {
            await page.goto(pageUrl(locale, "news"), {
              waitUntil: "domcontentloaded",
              timeout: 45000,
            });
            const coldNews = await filterLayout(page, "news", signals.counts);
            assert.deepEqual(coldNews.values, [
              "30",
              "publication",
              "all",
              "all",
              "latest",
            ]);
            assert.equal(coldNews.query, "");
            const firstAppearance = await appearance(page, theme);
            await navigate(page, "github", locale);
            const githubAfterNews = await filterLayout(
              page,
              "github",
              signals.counts,
            );
            await appearance(page, theme);
            await page.screenshot({
              path: join(out, `${locale}-${width}-${theme}-github.png`),
              animations: "disabled",
            });
            await navigate(page, "news", locale);
            const returningNews = await filterLayout(
              page,
              "news",
              signals.counts,
            );
            assert.deepEqual(
              returningNews,
              coldNews,
              "news changes after the GitHub stylesheet was loaded",
            );
            await appearance(page, theme);
            const fresh = await context.newPage();
            await fresh.goto(pageUrl(locale, "github"), {
              waitUntil: "domcontentloaded",
              timeout: 45000,
            });
            const coldGithub = await filterLayout(
              fresh,
              "github",
              signals.counts,
            );
            assert.deepEqual(
              coldGithub,
              githubAfterNews,
              "GitHub differs between cold and prior-news navigation",
            );
            await navigate(fresh, "news", locale);
            const newsAfterGithub = await filterLayout(
              fresh,
              "news",
              signals.counts,
            );
            assert.deepEqual(
              newsAfterGithub,
              coldNews,
              "cold-GitHub -> news differs from cold-news",
            );
            await appearance(fresh, theme);
            await fresh.screenshot({
              path: join(out, `${locale}-${width}-${theme}-news.png`),
              animations: "disabled",
            });
            Object.assign(item, {
              coldNews,
              returningNews,
              coldGithub,
              githubAfterNews,
              newsAfterGithub,
              appearance: firstAppearance,
            });
          },
        );
      }

  const history: LongitudinalHistory = JSON.parse(
    await readFile(join(process.cwd(), "data/analysis-history.json"), "utf8"),
  );
  const historyOrder = [...history.directions].sort(
    (a, b) =>
      Number(b.evidenceStatus === "sufficient") -
        Number(a.evidenceStatus === "sufficient") ||
      b.checks.filter((c) => c.passed).length -
        a.checks.filter((c) => c.passed).length ||
      a.id.localeCompare(b.id),
  );
  for (const locale of ["zh", "en"] as const)
    for (const theme of ["light", "dark"] as const) {
      await monitoredCase(
        `analysis-${locale}-${theme}`,
        locale,
        theme,
        1440,
        async (page, item, _context, observedAnalysis) => {
          const en = locale === "en";
          await page.goto(pageUrl(locale, "analysis"), {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          const panel = page.locator(".integrated-analysis"),
            native = panel.locator(".analysis-history");
          await expect(native).toHaveAttribute(
            "data-history-version",
            history.version,
            { timeout: 120000 },
          );
          const niche = panel.getByRole("button", {
            name: en ? "Niche trajectories" : "小众积累方向",
            exact: true,
          });
          const mainstream = panel.getByRole("button", {
            name: en ? "Mainstream directions" : "主流研究方向",
            exact: true,
          });
          await expect(niche).toHaveAttribute("aria-pressed", "true");
          await expect(mainstream).toHaveAttribute("aria-pressed", "false");
          await expect(
            panel.locator(".integrated-directions article"),
          ).toHaveCount(0);
          const cards = native.locator("article[data-history-id]");
          await expect(cards).toHaveCount(historyOrder.length);
          assert.deepEqual(
            await cards.evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute("data-history-id")),
            ),
            historyOrder.map((d) => d.id),
          );
          for (const toggle of await cards
            .locator("[data-history-toggle]")
            .all())
            await expect(toggle).toHaveAttribute("aria-expanded", "false");
          const sufficient = history.directions.filter(
            (d) => d.evidenceStatus === "sufficient",
          ).length;
          for (const [metric, count] of Object.entries({
            topics: history.directions.length,
            works: history.enrichedPaperCount,
            sufficient,
            pending: history.directions.length - sufficient,
          }))
            await expect(
              native.locator(`[data-history-count="${metric}"]`),
            ).toHaveText(String(count));
          const status = panel.getByRole("group", {
            name: en ? "Accumulation evidence status" : "积累证据状态",
          });
          const all = status.getByRole("button", {
            name: en ? "All directions" : "全部方向",
            exact: true,
          });
          await expect(all).toHaveAttribute("aria-pressed", "true");
          for (const [value, name] of [
            ["sufficient", en ? "Evidence sufficient" : "证据充分"],
            ["pending", en ? "Evidence pending" : "待补证据"],
          ] as const) {
            await status.getByRole("button", { name, exact: true }).click();
            await expect(cards).toHaveCount(
              history.directions.filter((d) => d.evidenceStatus === value)
                .length,
            );
            for (const card of await cards.all())
              await expect(card).toHaveAttribute("data-evidence-status", value);
          }
          await all.click();
          const first = cards.first(),
            toggle = first.locator("[data-history-toggle]");
          await expect(toggle).toHaveAccessibleName(
            new RegExp(en ? "Evidence and timeline" : "证据与时间线"),
          );
          await toggle.focus();
          await toggle.press("Enter");
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          for (const section of [
            "papers",
            "datasets",
            "repositories",
            "sources",
          ]) {
            const details = first.locator(
              `details[data-history-section="${section}"]`,
            );
            if ((await details.getAttribute("open")) === null) {
              await details.locator("summary").focus();
              await details.locator("summary").press("Enter");
            }
            await expect(details).toHaveAttribute("open", "");
          }
          await expect(
            first.locator(
              '[data-history-section="papers"] .analysis-history-timeline > li',
            ),
          ).toHaveCount(historyOrder[0].papers.length);
          const urls = await first
            .locator('[data-history-section="sources"] a[href]')
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const a = node as HTMLAnchorElement;
                if (
                  new URL(a.href).protocol !== "https:" ||
                  a.target !== "_blank" ||
                  !a.rel.includes("noopener") ||
                  !a.rel.includes("noreferrer")
                )
                  throw new Error("Unsafe evidence anchor");
                return a.href;
              }),
            );
          assert.deepEqual(
            urls,
            historyOrder[0].sources.map((source) => new URL(source.url).href),
          );
          item.desktopAppearance = await appearance(page, theme);
          await page.screenshot({
            path: join(out, `${locale}-analysis-${theme}-1440.png`),
            animations: "disabled",
          });
          await page.setViewportSize({ width: 390, height: 844 });
          item.mobileAppearance = await appearance(page, theme);
          await page.screenshot({
            path: join(out, `${locale}-analysis-${theme}-390.png`),
            animations: "disabled",
          });
          await toggle.focus();
          await toggle.press("Space");
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await mainstream.click();
          const run = panel.getByRole("button", {
            name: en ? "View rule analysis" : "查看规则分析",
            exact: true,
          });
          await expect(run).toBeEnabled({ timeout: 120000 });
          await expect
            .poll(() => observedAnalysis.includes(data.analysisContentSha256), {
              timeout: 120000,
              message:
                "Browser has not received the verified current analysis generation",
            })
            .toBe(true);
          await run.click();
          await expect(
            panel.locator(".integrated-toolbar span").first(),
          ).toContainText(number(data.paperCount), { timeout: 120000 });
          await expect(panel.locator(".integrated-counts strong")).toHaveText(
            ["paper", "github", "news"].map((kind) =>
              number(
                analysis.result.totals[kind as "paper" | "github" | "news"],
              ),
            ),
          );
          await expect(
            panel.locator(".integrated-directions > article h3"),
          ).toHaveText(analysis.result.directions.map((d) => d.label[locale]));
          for (const [
            index,
            direction,
          ] of analysis.result.directions.entries()) {
            const card = panel
              .locator(".integrated-directions > article")
              .nth(index);
            await expect(card.locator(".integrated-score strong")).toHaveText(
              pct(direction.score),
            );
            for (const [facetIndex, kind] of [
              "problems",
              "methods",
              "scenarios",
            ].entries()) {
              const expected = direction.facets[
                kind as "problems" | "methods" | "scenarios"
              ]
                .slice(0, 3)
                .map(
                  (f) =>
                    `${f.label[locale]} ${f.counts.paper} / ${f.counts.github} / ${f.counts.news}`,
                );
              assert.deepEqual(
                (
                  await card
                    .locator(".integrated-facets > section")
                    .nth(facetIndex)
                    .locator("details > summary")
                    .allTextContents()
                ).map(normalize),
                expected,
              );
            }
          }
          await niche.click();
          await expect(cards).toHaveCount(history.directions.length);
          const lexical = panel.locator("details.integrated-lexical");
          await lexical.locator(":scope > summary").click();
          await expect(
            lexical.locator(".integrated-lexical-card h3"),
          ).toHaveText(
            analysis.result.niches.slice(0, 12).map((n) => n.label[locale]),
          );
          assert.deepEqual(
            await lexical
              .locator(".integrated-lexical-card")
              .evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute("data-evidence-status")),
              ),
            analysis.result.niches.slice(0, 12).map((n) => n.evidenceStatus),
          );
          await expect(panel.locator("iframe")).toHaveCount(0);
          await expect(panel.locator('[role="alert"]')).toHaveCount(0);
          await appearance(page, theme);
          item.historyVersion = history.version;
          item.currentAnalysisSemanticSha256 = data.analysisContentSha256;
        },
      );
    }
  for (const locale of ["zh", "en"] as const) {
    await monitoredCase(
      `papers-${locale}`,
      locale,
      "light",
      1440,
      async (page, item) => {
        await page.goto(pageUrl(locale, "papers"), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await expect(page.locator(".research-dashboard")).toBeVisible({
          timeout: 120000,
        });
        await expect(page.locator(".sidebar-note")).toContainText(
          number(data.paperCount),
          { timeout: 120000 },
        );
        item.desktopAppearance = await appearance(page, "light");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: "dark" });
        item.mobileAppearance = await appearance(page, "dark");
        await page.screenshot({
          path: join(out, `${locale}-papers-390-dark.png`),
          animations: "disabled",
        });
      },
    );
  }
  await stage("verify-generation-did-not-change-during-audit");
  const [webEnd, dataEnd] = await Promise.all([
    getJson(webBase + "deployment.json", true),
    getJson(dataBase + "deployment.json", true),
  ]);
  assert.equal(
    webEnd.sha256,
    webResponse.sha256,
    "Web deployment changed during verification; rerun with its new revision",
  );
  assert.equal(
    dataEnd.sha256,
    dataResponse.sha256,
    "Data deployment changed during verification; rerun with its new revision",
  );
  assert.equal(
    browserCases.length,
    14,
    "Release verification requires all 14 browser cases",
  );
  assert.ok(
    browserCases.every((item) => item.passed === true),
    "Every browser case must pass",
  );
  report.passed = true;
  report.completedAt = new Date().toISOString();
  report.stage = "completed";
  await save();
  console.log(
    JSON.stringify({
      passed: true,
      web: expectedWeb,
      data: expectedData,
      papers: data.paperCount,
      signals: data.signalCount,
      browserCases: browserCases.length,
      report: reportPath,
    }),
  );
} catch (error) {
  report.error =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : String(error);
  await save();
  throw error;
} finally {
  await api.dispose();
  if (browser) await browser.close();
}

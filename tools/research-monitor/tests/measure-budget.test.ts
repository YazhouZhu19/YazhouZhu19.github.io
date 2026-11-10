import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { checkBudget, measureBuild, resourceKey, type BudgetConfig } from "../scripts/measure-budget";
import { writeSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot, writePublicSnapshotV3 } from "../scripts/public-snapshot";

const config: BudgetConfig = {
  schemaVersion: 1,
  initialData: [
    { id: "papers", path: "data/public-papers-v2.json", kind: "paper-snapshot" },
    { id: "signals", path: "data/research-signals.json", kind: "file" },
  ],
  limits: { assets: {}, totals: {}, datasets: {} },
};

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "monitor-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of [".vite", "assets", "data/papers", "en"])
    await mkdir(join(root, dir), { recursive: true });
  const files = {
    "index.html": '<script type="module" src="/research-monitor/assets/zh-12345678.js"></script>',
    "en/index.html": '<script type="module" src="/research-monitor/assets/en-12345678.js"></script>',
    "assets/zh-12345678.js": "import './shared-abcdefgh.js';",
    "assets/en-12345678.js": "import './shared-abcdefgh.js';",
    "assets/shared-abcdefgh.js": "shared initial module",
    "assets/later-12345678.js": "later view module",
    "assets/ai-worker-12345678.js": "click-to-run worker",
    "assets/main-12345678.css": "body{color:black}",
    "assets/later-12345678.css": ".later{color:red}",
    "data/research-signals.json": JSON.stringify({ records: [{ id: "repo:a/b" }] }),
    "data/papers/unused.json": "old compatibility shard must not count",
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  await writeFile(
    join(root, ".vite/manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "assets/zh-12345678.js",
        isEntry: true,
        imports: ["shared"],
        dynamicImports: ["later"],
      },
      "en/index.html": { file: "assets/en-12345678.js", isEntry: true, imports: ["shared"] },
      shared: { file: "assets/shared-abcdefgh.js", css: ["assets/main-12345678.css"] },
      later: { file: "assets/later-12345678.js", imports: ["shared"], css: ["assets/later-12345678.css"] },
    }),
  );
  const shard = JSON.stringify([{ id: "paper:one", title: "Imaging paper", provenance: [] }]);
  const hash = createHash("sha256").update(shard).digest("hex");
  await writeFile(join(root, `data/papers/${hash}.json`), shard);
  await writeFile(
    join(root, "data/public-papers-v2.json"),
    JSON.stringify({
      schema: "research-monitor-shards-v2",
      totalStored: 1,
      metadata: { totalStored: 1 },
      queryUrls: [],
      shards: [{ path: `papers/${hash}.json`, count: 1, bytes: Buffer.byteLength(shard), sha256: hash }],
    }),
  );
  return root;
}

test("startup measurement deduplicates shared entry imports and excludes optional code and old data generations", async (t) => {
  const root = await fixture(t);
  const report = await measureBuild(root, config);
  assert.equal(report.assets.length, 7);
  assert.deepEqual(
    report.assets
      .filter((asset) => asset.initial)
      .map((asset) => asset.key)
      .sort(),
    ["assets/en.js", "assets/main.css", "assets/shared.js", "assets/zh.js"],
  );
  assert.equal(report.initialData[0].records, 1);
  assert.equal(report.initialData[0].files.length, 2);
  assert.ok(
    report.initialData.every((dataset) => dataset.files.every((file) => !file.path.includes("unused"))),
  );
  for (const dataset of report.initialData) {
    let rawBytes = 0,
      gzipBytes = 0;
    for (const file of dataset.files) {
      const bytes = await readFile(join(root, file.path));
      rawBytes += bytes.length;
      gzipBytes += gzipSync(bytes, { level: 9 }).length;
    }
    assert.deepEqual({ rawBytes: dataset.rawBytes, gzipBytes: dataset.gzipBytes }, { rawBytes, gzipBytes });
  }
  assert.equal(
    report.totals.initialData.rawBytes,
    report.initialData.reduce((sum, item) => sum + item.rawBytes, 0),
  );
  assert.equal(
    report.totals.initialMeasuredResources.rawBytes,
    report.totals.initialJs.rawBytes + report.totals.initialCss.rawBytes + report.totals.initialData.rawBytes,
  );
});

test("explicit first-view dynamic entries count their CSS and imports without counting a click-to-run worker", async (t) => {
  const root = await fixture(t);
  const report = await measureBuild(root, { ...config, initialDynamicEntries: ["later"] });
  assert.equal(report.assets.find((asset) => asset.key === "assets/later.js")?.initial, true);
  assert.equal(report.assets.find((asset) => asset.key === "assets/later.css")?.initial, true);
  assert.equal(report.assets.find((asset) => asset.key === "assets/ai-worker.js")?.initial, false);
});

test("Vite merged locale entrypoints without isEntry are measured from their emitted HTML", async (t) => {
  const root = await fixture(t);
  const path = join(root, ".vite/manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  delete manifest["index.html"].isEntry;
  delete manifest["en/index.html"].isEntry;
  await writeFile(path, JSON.stringify(manifest));
  const report = await measureBuild(root, config);
  assert.equal(report.assets.filter((asset) => asset.initial).length, 4);
});

test("budgets fail on any resource, startup total or dataset regression and require a rule for new chunks", async (t) => {
  const root = await fixture(t);
  const report = await measureBuild(root, config);
  const exact: BudgetConfig = {
    ...config,
    limits: {
      assets: Object.fromEntries(report.assets.map((asset) => [asset.key, asset])),
      totals: report.totals,
      datasets: Object.fromEntries(
        report.initialData.map((dataset) => [
          dataset.id,
          {
            ...dataset,
            fileRawBytes: Math.max(...dataset.files.map((file) => file.rawBytes)),
            fileGzipBytes: Math.max(...dataset.files.map((file) => file.gzipBytes)),
          },
        ]),
      ),
    },
  };
  assert.deepEqual(checkBudget(report, exact), []);
  const missing = structuredClone(exact);
  delete missing.limits.assets["assets/ai-worker.js"];
  assert.match(checkBudget(report, missing).join("\n"), /assets\/ai-worker.js: missing/);
  const tooSmall = structuredClone(exact);
  tooSmall.limits.assets["assets/later.js"].gzipBytes -= 1;
  tooSmall.limits.totals.initialJs.rawBytes -= 1;
  tooSmall.limits.datasets.papers.fileRawBytes -= 1;
  assert.equal(checkBudget(report, tooSmall).length, 3);
});

test("missing manifest dependencies and mismatched data bytes cannot yield a passing measurement", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    measureBuild(root, { ...config, initialDynamicEntries: ["missing"] }),
    /Missing Vite manifest entry/,
  );
  const manifestFile = join(root, "data/public-papers-v2.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.shards[0].bytes += 1;
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(measureBuild(root, config), /Manifest byte count differs/);
});

test("resource budgets follow a stable name across Vite hash changes without erasing worker names", () => {
  assert.equal(resourceKey("assets/ai-worker-abcdefgh.js"), "assets/ai-worker.js");
  assert.equal(resourceKey("assets/main-X_9-yzAB.css"), "assets/main.css");
  assert.equal(resourceKey("plain.js"), "plain.js");
});

test("startup worker assets outside the page manifest are counted and cannot silently disappear", async (t) => {
  const root = await fixture(t);
  const report = await measureBuild(root, { ...config, initialAssetKeys: ["assets/ai-worker.js"] });
  assert.equal(report.assets.find((asset) => asset.key === "assets/ai-worker.js")?.initial, true);
  await assert.rejects(
    measureBuild(root, { ...config, initialAssetKeys: ["assets/missing.js"] }),
    /must resolve once/,
  );
});

test("bounded record growth allows more papers but never relaxes code or individual-file limits", () => {
  const report: Parameters<typeof checkBudget>[0] = {
    schemaVersion: 1,
    measuredAt: "test",
    compression: "test",
    notes: [],
    violations: [],
    assets: [{ path: "main.js", key: "main.js", type: "js", initial: true, rawBytes: 10, gzipBytes: 5 }],
    initialData: [
      {
        id: "papers",
        records: 200,
        rawBytes: 200,
        gzipBytes: 40,
        files: [{ path: "shard.json", role: "shard", rawBytes: 10, gzipBytes: 5 }],
      },
    ],
    totals: {
      initialData: { rawBytes: 200, gzipBytes: 40 },
      initialMeasuredResources: { rawBytes: 210, gzipBytes: 45 },
    },
  };
  const limits: BudgetConfig = {
    schemaVersion: 1,
    initialData: [],
    paperGrowth: { referenceRecords: 100, maxRecords: 300 },
    limits: {
      assets: { "main.js": { rawBytes: 10, gzipBytes: 5 } },
      totals: {
        initialData: { rawBytes: 100, gzipBytes: 20 },
        initialMeasuredResources: { rawBytes: 110, gzipBytes: 25 },
      },
      datasets: { papers: { rawBytes: 100, gzipBytes: 20, fileRawBytes: 10, fileGzipBytes: 5 } },
    },
  };
  const unchanged = JSON.stringify(limits);
  assert.deepEqual(checkBudget(report, limits), []);
  report.assets[0].rawBytes++;
  assert.ok(checkBudget(report, limits).some((v) => v.startsWith("main.js:")));
  report.assets[0].rawBytes--;
  report.initialData[0].files[0].rawBytes++;
  assert.ok(checkBudget(report, limits).some((v) => v.startsWith("shard.json:")));
  report.initialData[0].files[0].rawBytes--;
  report.initialData[0].rawBytes++;
  assert.ok(checkBudget(report, limits).some((v) => v.startsWith("data:papers:")));
  report.initialData[0].records = 301;
  assert.ok(checkBudget(report, limits).some((v) => v.includes("reviewed maximum")));
  assert.equal(JSON.stringify(limits), unchanged);
});

test("deferred paper snapshots stay measured and budgeted without inflating startup data", async (t) => {
  const root = await fixture(t);
  const deferred: BudgetConfig = {
    ...config,
    initialData: [config.initialData[1]],
    optionalData: [config.initialData[0]],
  };
  const report = await measureBuild(root, deferred);
  assert.equal(report.initialData.length, 1);
  assert.equal(report.optionalData?.[0].id, "papers");
  assert.equal(report.totals.initialData.rawBytes, report.initialData[0].rawBytes);
  deferred.limits = {
    ...deferred.limits,
    datasets: { papers: { rawBytes: 0, gzipBytes: 0, fileRawBytes: 0, fileGzipBytes: 0 } },
  };
  assert.ok(
    checkBudget(report, deferred).some(
      (message) => message.startsWith("data:papers: rawBytes") && message.includes("exceeds"),
    ),
  );
  assert.ok(
    checkBudget(report, deferred).some(
      (message) => message.startsWith("data/papers/") && message.includes("exceeds"),
    ),
  );
});

test("provenance growth is counted from verified v1/v2/v3 records, ignoring metadata counters", async (t) => {
  const root = await fixture(t);
  const source = {
    totalStored: 1,
    provenanceEntries: 999999,
    papers: [
      {
        id: "one",
        title: "Paper",
        authors: [],
        provenance: [
          { queryUrl: "https://example.org/query", collectedAt: "2026-11-11T00:00:00Z" },
          { queryUrl: "https://example.org/query", collectedAt: "2026-11-11T01:00:00Z" },
        ],
      },
    ],
  };
  for (const writer of [writeSnapshotFile, writePublicSnapshot, writePublicSnapshotV3]) {
    await writer(join(root, "data/public-papers-v2.json"), source);
    const report = await measureBuild(root, config);
    assert.equal(report.initialData[0].provenanceEntries, 2);
  }
  const manifestPath = join(root, "data/public-papers-v2.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const shardPath = join(root, "data", manifest.shards[0].path);
  const text = await readFile(shardPath, "utf8");
  await writeFile(shardPath, text.replace('"Paper"', '"Other"'));
  await assert.rejects(measureBuild(root, config), /checksum mismatch/);
});

function historyBudgetFixture() {
  const report: Parameters<typeof checkBudget>[0] = {
    schemaVersion: 1,
    measuredAt: "test",
    compression: "test",
    notes: [],
    violations: [],
    assets: [{ path: "main.js", key: "main.js", type: "js", initial: true, rawBytes: 10, gzipBytes: 5 }],
    initialData: [
      {
        id: "paper-overview",
        rawBytes: 20,
        gzipBytes: 10,
        files: [{ path: "overview.json", role: "file", rawBytes: 20, gzipBytes: 10 }],
      },
    ],
    optionalData: [
      {
        id: "papers",
        records: 100,
        provenanceEntries: 20,
        rawBytes: 100,
        gzipBytes: 50,
        files: [{ path: "shard.json", role: "shard", rawBytes: 10, gzipBytes: 5 }],
      },
    ],
    totals: {
      initialJs: { rawBytes: 10, gzipBytes: 5 },
      initialData: { rawBytes: 20, gzipBytes: 10 },
      initialMeasuredResources: { rawBytes: 30, gzipBytes: 15 },
    },
  };
  const limits: BudgetConfig = {
    schemaVersion: 1,
    initialData: [],
    paperGrowth: {
      referenceRecords: 100,
      maxRecords: 300,
      provenance: { referenceEntries: 20, maxEntries: 80, bytesPerEntry: { rawBytes: 4, gzipBytes: 2 } },
    },
    limits: {
      assets: { "main.js": { rawBytes: 10, gzipBytes: 5 } },
      totals: structuredClone(report.totals),
      datasets: {
        "paper-overview": { rawBytes: 20, gzipBytes: 10, fileRawBytes: 20, fileGzipBytes: 10 },
        papers: { rawBytes: 100, gzipBytes: 50, fileRawBytes: 10, fileGzipBytes: 5 },
      },
    },
  };
  return { report, limits };
}

test("new history for existing papers earns only a bounded complete-paper allowance", () => {
  const { report, limits } = historyBudgetFixture();
  const original = JSON.stringify(limits);
  const papers = report.optionalData![0];
  assert.deepEqual(checkBudget(report, limits), []);
  papers.provenanceEntries = 21;
  papers.rawBytes = 104;
  papers.gzipBytes = 52;
  assert.deepEqual(checkBudget(report, limits), []);
  papers.rawBytes++;
  papers.gzipBytes++;
  assert.equal(checkBudget(report, limits).filter((v) => v.startsWith("data:papers:")).length, 2);
  papers.rawBytes = 104;
  papers.gzipBytes = 52;
  report.assets[0].rawBytes++;
  report.initialData[0].rawBytes++;
  report.totals.initialData.rawBytes++;
  report.totals.initialMeasuredResources.rawBytes++;
  papers.files[0].rawBytes++;
  for (const prefix of [
    "main.js:",
    "data:paper-overview:",
    "total:initialData:",
    "total:initialMeasuredResources:",
    "shard.json:",
  ])
    assert.ok(
      checkBudget(report, limits).some((v) => v.startsWith(prefix)),
      prefix,
    );
  assert.equal(JSON.stringify(limits), original);
});

test("record growth does not double-pay baseline provenance; record and history maxima stay enforced", () => {
  const { report, limits } = historyBudgetFixture();
  const papers = report.optionalData![0];
  papers.records = 200;
  papers.provenanceEntries = 40;
  papers.rawBytes = 200;
  papers.gzipBytes = 100;
  assert.deepEqual(checkBudget(report, limits), []);
  papers.rawBytes++;
  assert.ok(checkBudget(report, limits).some((v) => v.startsWith("data:papers:")));
  papers.provenanceEntries++;
  assert.deepEqual(checkBudget(report, limits), []);
  papers.provenanceEntries = 81;
  assert.ok(checkBudget(report, limits).some((v) => v.includes("provenance count 81 exceeds")));
  papers.records = 301;
  assert.ok(checkBudget(report, limits).some((v) => v.includes("Paper count 301 exceeds")));
});

test("missing or invalid provenance measurements and limits cannot waive the budget", () => {
  const { report, limits } = historyBudgetFixture();
  for (const value of [undefined, -1, NaN, 0.5, Infinity]) {
    report.optionalData![0].provenanceEntries = value;
    assert.ok(checkBudget(report, limits).includes("Invalid bounded paper provenance growth budget"));
  }
  report.optionalData![0].provenanceEntries = 21;
  for (const history of [
    { referenceEntries: -1, maxEntries: 80, bytesPerEntry: { rawBytes: 4, gzipBytes: 2 } },
    { referenceEntries: 20, maxEntries: 19, bytesPerEntry: { rawBytes: 4, gzipBytes: 2 } },
    { referenceEntries: 20, maxEntries: 80, bytesPerEntry: { rawBytes: Infinity, gzipBytes: 2 } },
  ]) {
    limits.paperGrowth!.provenance = history;
    assert.ok(checkBudget(report, limits).includes("Invalid bounded paper provenance growth budget"));
  }
});

test("the reviewed production envelope covers run 42899828413 while preserving fixed limits", async () => {
  const production: BudgetConfig = JSON.parse(
    await readFile(new URL("../budget.json", import.meta.url), "utf8"),
  );
  const { report } = historyBudgetFixture();
  report.assets = [];
  report.initialData = [];
  report.totals = {};
  report.optionalData = [
    { id: "papers", records: 11361, provenanceEntries: 151125, rawBytes: 77496667, gzipBytes: 0, files: [] },
  ];
  // The original failed raw total is known; no gzip or provenance growth credit
  // is needed for this regression. Full collection is verified again in Actions.
  assert.deepEqual(checkBudget(report, production), []);
  assert.equal(production.limits.datasets.papers.fileRawBytes, 4 * 1024 * 1024);
  assert.equal(production.limits.datasets.papers.gzipBytes, 12733440);
  assert.equal(production.limits.datasets["paper-overview"].rawBytes, 14680064);
});

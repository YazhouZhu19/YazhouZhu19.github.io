import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { checkBudget, measureBuild, resourceKey, type BudgetConfig } from "../scripts/measure-budget";

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

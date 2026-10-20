import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parseSnapshotManifest } from "../lib/snapshot";

export type Size = { rawBytes: number; gzipBytes: number };
type Asset = Size & { path: string; key: string; type: "js" | "css"; initial: boolean };
type DataFile = Size & { path: string; role: "manifest" | "shard" | "file" };
type Dataset = Size & { id: string; records?: number; files: DataFile[] };
type ViteChunk = { file: string; isEntry?: boolean; imports?: string[]; css?: string[] };
type DataInput = { id: string; path: string; kind: "paper-snapshot" | "file" };
export type BudgetConfig = {
  schemaVersion: 1;
  baseline?: { measuredAt: string; sourceRevision: string; notes: string[] };
  basePath?: string;
  entryHtml?: string[];
  initialData: DataInput[];
  initialDynamicEntries?: string[];
  initialAssetKeys?: string[];
  limits: {
    assets: Record<string, Size>;
    totals: Record<string, Size>;
    datasets: Record<string, Size & { fileRawBytes: number; fileGzipBytes: number }>;
  };
};
export type BudgetReport = {
  schemaVersion: 1;
  measuredAt: string;
  compression: string;
  notes: string[];
  assets: Asset[];
  initialData: Dataset[];
  totals: Record<string, Size>;
  violations: string[];
};

function total(items: Size[]): Size {
  return items.reduce(
    (sum, item) => ({
      rawBytes: sum.rawBytes + item.rawBytes,
      gzipBytes: sum.gzipBytes + item.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );
}

/** Keep the logical resource identity stable when Vite's content hash changes. */
export function resourceKey(path: string): string {
  return path.replace(/-[\w-]{8}\.(js|css)$/, ".$1");
}

function within(root: string, path: string): string {
  const file = resolve(root, path);
  if (!file.startsWith(resolve(root) + sep)) throw new Error(`Budget path leaves build output: ${path}`);
  return file;
}

async function measure(root: string, path: string): Promise<Size> {
  const bytes = await readFile(within(root, path));
  return { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
}

async function resourcePaths(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "data" && entry.name !== ".vite") files.push(...(await resourcePaths(root, path)));
    } else if ([".js", ".css"].includes(extname(path))) {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

async function initialResources(root: string, manifest: Record<string, ViteChunk>, config: BudgetConfig) {
  const resources = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string) {
    if (visited.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing Vite manifest entry: ${key}`);
    visited.add(key);
    resources.add(chunk.file);
    for (const css of chunk.css ?? []) resources.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  const basePath = config.basePath ?? "/research-monitor/";
  // Vite 8 can merge identical locale entry modules and omit isEntry from its
  // manifest. Start at the scripts/styles that the emitted HTML really loads.
  for (const htmlFile of config.entryHtml ?? ["index.html", "en/index.html"]) {
    const html = await readFile(within(root, htmlFile), "utf8");
    for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const attrs = Object.fromEntries(
        [...tag[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [
          match[1].toLowerCase(),
          match[2],
        ]),
      );
      const source =
        tag[1].toLowerCase() === "script" && attrs.type === "module"
          ? attrs.src
          : ["stylesheet", "modulepreload"].includes(attrs.rel)
            ? attrs.href
            : undefined;
      if (!source) continue;
      const url = new URL(source, `https://build.invalid${basePath}${htmlFile}`);
      if (url.origin !== "https://build.invalid" || !url.pathname.startsWith(basePath)) {
        throw new Error(`Initial resource is outside the measured build: ${source}`);
      }
      const path = url.pathname.slice(basePath.length);
      resources.add(path);
      const entry = Object.entries(manifest).find(([, chunk]) => chunk.file === path);
      if (entry) visit(entry[0]);
      else if (path.endsWith(".js")) throw new Error(`Initial module is absent from Vite manifest: ${path}`);
    }
  }
  if (resources.size === 0) throw new Error("Built locale entries contain no initial resources");
  for (const key of config.initialDynamicEntries ?? []) visit(key);
  return resources;
}

async function measureDataset(root: string, input: DataInput): Promise<Dataset> {
  const files: DataFile[] = [];
  const first = await measure(root, input.path);
  if (input.kind === "paper-snapshot") {
    const manifest = parseSnapshotManifest(JSON.parse(await readFile(within(root, input.path), "utf8")));
    files.push({ path: input.path, role: "manifest", ...first });
    for (const shard of manifest.shards) {
      const path = join(dirname(input.path), shard.path).split(sep).join("/");
      const size = await measure(root, path);
      if (size.rawBytes !== shard.bytes) throw new Error(`Manifest byte count differs: ${path}`);
      files.push({ path, role: "shard", ...size });
    }
    return { id: input.id, records: manifest.totalStored, files, ...total(files) };
  }
  files.push({ path: input.path, role: "file", ...first });
  return { id: input.id, files, ...first };
}

export function checkBudget(report: BudgetReport, config: BudgetConfig): string[] {
  const violations: string[] = [];
  function check(label: string, actual: Size, limit: Size | undefined) {
    if (
      !limit ||
      !Number.isSafeInteger(limit.rawBytes) ||
      limit.rawBytes < 0 ||
      !Number.isSafeInteger(limit.gzipBytes) ||
      limit.gzipBytes < 0
    ) {
      violations.push(`${label}: missing or invalid budget; review and add an explicit limit`);
      return;
    }
    for (const unit of ["rawBytes", "gzipBytes"] as const) {
      if (actual[unit] > limit[unit])
        violations.push(`${label}: ${unit} ${actual[unit]} exceeds ${limit[unit]}`);
    }
  }
  for (const asset of report.assets) check(asset.key, asset, config.limits.assets[asset.key]);
  for (const [key, size] of Object.entries(report.totals))
    check(`total:${key}`, size, config.limits.totals[key]);
  for (const dataset of report.initialData) {
    const limits = config.limits.datasets[dataset.id];
    check(`data:${dataset.id}`, dataset, limits);
    for (const file of dataset.files) {
      check(
        file.path,
        file,
        limits ? { rawBytes: limits.fileRawBytes, gzipBytes: limits.fileGzipBytes } : undefined,
      );
    }
  }
  return violations;
}

export async function measureBuild(root: string, config: BudgetConfig): Promise<BudgetReport> {
  if (config.schemaVersion !== 1 || !Array.isArray(config.initialData))
    throw new Error("Invalid budget configuration");
  const manifest = JSON.parse(await readFile(join(root, ".vite/manifest.json"), "utf8"));
  const initial = await initialResources(root, manifest, config);
  const paths = await resourcePaths(root);
  // Worker entrypoints are emitted outside Vite's page manifest. Declare their
  // stable resource keys explicitly so startup worker bytes never hide as optional.
  for (const key of config.initialAssetKeys ?? []) {
    const matches = paths.filter((path) => resourceKey(path) === key);
    if (matches.length !== 1) throw new Error(`Initial asset key must resolve once: ${key}`);
    initial.add(matches[0]);
  }
  const assets: Asset[] = [];
  for (const path of paths)
    assets.push({
      path,
      key: resourceKey(path),
      type: extname(path) === ".js" ? "js" : "css",
      initial: initial.has(path),
      ...(await measure(root, path)),
    });
  for (const path of initial) {
    if (/\.(js|css)$/.test(path) && !paths.includes(path))
      throw new Error(`Missing initial resource: ${path}`);
  }
  const initialData: Dataset[] = [];
  for (const input of config.initialData) initialData.push(await measureDataset(root, input));
  const totals = {
    initialJs: total(assets.filter((asset) => asset.initial && asset.type === "js")),
    initialCss: total(assets.filter((asset) => asset.initial && asset.type === "css")),
    optionalJs: total(assets.filter((asset) => !asset.initial && asset.type === "js")),
    optionalCss: total(assets.filter((asset) => !asset.initial && asset.type === "css")),
    initialData: total(initialData),
    initialMeasuredResources: total([...assets.filter((asset) => asset.initial), ...initialData]),
  };
  const report: BudgetReport = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    compression: "gzip level 9, each HTTP resource compressed independently; bytes, not kB/KiB",
    notes: [
      "Initial JS/CSS follows static imports of both locale entries plus configured first-view dynamic entries and startup worker assets; shared resources are counted once.",
      "The initialData list mirrors current startup loading. Update it together with any loader change; all manifest-referenced shards are included.",
      "Unreferenced archive generations and v1 compatibility files are excluded from startup transfer, but remain published.",
      "Optional resources include later views and click-to-run WebLLM/AI workers. Model weights fetched from external providers are not build resources.",
      "The measured initial total covers JS, CSS and configured startup data, excluding HTML, images, HTTP headers and external requests; gzip is an estimate, not a browser network trace.",
    ],
    assets,
    initialData,
    totals,
    violations: [],
  };
  report.violations = checkBudget(report, config);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--report-only"))
    throw new Error("Usage: tsx scripts/measure-budget.ts [--report-only]");
  const config: BudgetConfig = JSON.parse(await readFile("budget.json", "utf8"));
  const report = await measureBuild("dist", config);
  await writeFile("dist/budget-report.json", JSON.stringify(report, null, 2) + "\n");
  console.table(
    report.assets.map((asset) => ({
      resource: asset.path,
      load: asset.initial ? "initial" : "optional",
      rawBytes: asset.rawBytes,
      gzipBytes: asset.gzipBytes,
    })),
  );
  console.table(
    report.initialData.map((dataset) => ({
      dataset: dataset.id,
      records: dataset.records ?? "",
      files: dataset.files.length,
      rawBytes: dataset.rawBytes,
      gzipBytes: dataset.gzipBytes,
    })),
  );
  console.table(Object.entries(report.totals).map(([scope, size]) => ({ scope, ...size })));
  console.log(`Report: dist/budget-report.json (${report.compression})`);
  if (report.violations.length > 0) {
    for (const violation of report.violations) console.error(`Budget: ${violation}`);
    if (!args.includes("--report-only")) process.exitCode = 1;
  } else console.log("All resource and startup budgets passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

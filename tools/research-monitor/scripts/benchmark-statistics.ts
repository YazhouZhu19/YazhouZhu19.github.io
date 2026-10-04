/**
 * Run with: node --import tsx scripts/benchmark-statistics.ts [--baseline-dir /tmp/old-lib]
 * Optional: --snapshot data/papers.json --now 2026-10-04T06:00:00Z --iterations 3
 * A baseline directory contains the previous dashboard.ts, analysis.ts and their local imports.
 * Inputs are held fixed; timings exclude disk reads, result assertions and fresh record copies.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDashboard, defaultDashboardFilters } from "../lib/dashboard";
import { buildPreliminaryAnalysis } from "../lib/analysis";
import { parseSnapshotManifest } from "../lib/snapshot";
import type { MonitorData, Paper } from "../lib/types";

const args = process.argv.slice(2);
const argument = (key: string, fallback: string) => {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${key}`);
  return args[index + 1];
};
const root = fileURLToPath(new URL("../", import.meta.url));
const snapshotPath = resolve(root, argument("--snapshot", "data/papers.json"));
const manifestText = await readFile(snapshotPath, "utf8");
const manifest = parseSnapshotManifest(JSON.parse(manifestText));
const papers: Paper[] = (await Promise.all(manifest.shards.map(async shard => JSON.parse(await readFile(resolve(dirname(snapshotPath), shard.path), "utf8")) as Paper[]))).flat();
const snapshot = { ...manifest.metadata, papers, storageAvailable: true } as MonitorData;
const now = new Date(argument("--now", "2026-10-04T06:00:00Z"));
const iterations = Number(argument("--iterations", "3"));
assert.ok(Number.isFinite(now.getTime()), "--now must be a valid timestamp");
assert.ok(Number.isInteger(iterations) && iterations > 0 && iterations <= 20, "--iterations must be between 1 and 20");
const baselineDir = argument("--baseline-dir", "");
const baselineDashboard: typeof buildDashboard | undefined = baselineDir ? (await import(pathToFileURL(resolve(baselineDir, "dashboard.ts")).href)).buildDashboard : undefined;
const baselineAnalysis: typeof buildPreliminaryAnalysis | undefined = baselineDir ? (await import(pathToFileURL(resolve(baselineDir, "analysis.ts")).href)).buildPreliminaryAnalysis : undefined;
const freshData = (): MonitorData => ({ ...snapshot, papers: papers.map(paper => ({ ...paper })) });
const measure = <T>(run: () => T) => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};
const warmMedian = (run: () => unknown) => {
  const timings = Array.from({length: iterations}, () => measure(run).ms).sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)];
};
const round = (value: number) => Math.round(value * 10) / 10;
console.log(JSON.stringify({
  snapshot: snapshotPath, manifestSha256: createHash("sha256").update(manifestText).digest("hex"), now: now.toISOString(),
  papers: papers.length, shards: manifest.shards.length, iterations,
  snapshotMiB: round(manifest.shards.reduce((sum, shard) => sum + shard.bytes, 0) / 1048576),
}));

for (const scenario of [
  {name: "dashboard:30d-publication", filters: defaultDashboardFilters},
  {name: "dashboard:all-discovery", filters: {...defaultDashboardFilters, days: "all", clock: "discovery" as const}},
]) {
  const input = freshData();
  const baseline = baselineDashboard ? measure(() => baselineDashboard(input, [], scenario.filters, now)) : undefined;
  const optimized = measure(() => buildDashboard(input, [], scenario.filters, now));
  if (baseline) assert.deepStrictEqual(optimized.value, baseline.value, `${scenario.name}: output changed`);
  console.log(JSON.stringify({
    scenario: scenario.name, deepEqual: baseline ? true : "no baseline supplied", rows: optimized.value.rows.length,
    baselineFirstMs: baseline && round(baseline.ms), optimizedFirstMs: round(optimized.ms),
    baselineMedianMs: baselineDashboard && round(warmMedian(() => baselineDashboard(input, [], scenario.filters, now))),
    optimizedMedianMs: round(warmMedian(() => buildDashboard(input, [], scenario.filters, now))),
  }));
}

for (const days of ["30", "all"]) {
  const filters = {...defaultDashboardFilters, days};
  const input = freshData();
  const baseline = baselineAnalysis ? measure(() => baselineAnalysis(input, filters, [], now)) : undefined;
  const optimized = measure(() => buildPreliminaryAnalysis(input, filters, [], now));
  if (baseline) assert.deepStrictEqual(optimized.value, baseline.value, `analysis:${days}: output changed`);
  const fastInput = freshData();
  const fast = measure(() => buildPreliminaryAnalysis(fastInput, filters, [], now, {skipPeople: true}));
  const withoutPeople = ({authorsTop, coauthorPairs, coauthorExcludedLargePapers, watchlistMatches, ...visible}: typeof optimized.value) => visible;
  assert.deepStrictEqual(withoutPeople(fast.value), withoutPeople(optimized.value), `analysis:${days}: skipPeople changed displayed data`);
  console.log(JSON.stringify({
    scenario: `analysis:${days}`, deepEqual: baseline ? true : "no baseline supplied", visibleDataEqual: true, rows: optimized.value.scope.total,
    baselineFirstMs: baseline && round(baseline.ms), optimizedFirstMs: round(optimized.ms), skipPeopleFirstMs: round(fast.ms),
    baselineMedianMs: baselineAnalysis && round(warmMedian(() => baselineAnalysis(input, filters, [], now))),
    optimizedMedianMs: round(warmMedian(() => buildPreliminaryAnalysis(input, filters, [], now))),
    skipPeopleMedianMs: round(warmMedian(() => buildPreliminaryAnalysis(fastInput, filters, [], now, {skipPeople: true}))),
  }));
}

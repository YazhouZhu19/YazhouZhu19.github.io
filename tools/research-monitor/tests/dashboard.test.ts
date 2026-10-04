import assert from "node:assert/strict";
import test from "node:test";
import { beijingDay, buildDashboard, buildSourceHealth, defaultDashboardFilters } from "../lib/dashboard";
import { TASKS, TRACKS } from "../lib/classify";
import type { MonitorData, Paper, SyncRun } from "../lib/types";

const now = new Date("2026-09-18T04:00:00Z");
const initialAt = "2026-09-10T01:00:00Z";
const paper = (id: string, overrides: Partial<Paper> = {}): Paper => ({
  id, title: `Research ${id}`, abstract: "Medical image research", authors: [], affiliations: [],
  doi: null, source: "Europe PMC", sources: ["Europe PMC"], status: "published", publishedAt: "2026-09-16",
  updatedAt: null, firstSeenAt: "2026-09-16T03:00:00Z", venue: null, url: `https://example.org/${id}`,
  tracks: ["foundation"], tasks: ["segmentation"], modalities: ["MRI"], organs: [], methods: ["基础模型"],
  humanSignals: [], evidence: [], reviewStatus: "unreviewed", provenance: [], ...overrides,
});
const dataset = (papers: Paper[]): MonitorData => ({
  papers, runs: [], queryRuns: [], storageAvailable: true, coverage: "test", lastSuccessfulSync: now.toISOString(),
  // A recent collection timestamp must not shift the original import boundary.
  collectedAt: now.toISOString(),
});
const sample = () => dataset([
  paper("initial", { firstSeenAt: initialAt, publishedAt: "2026-09-01", tracks: ["segmentation"] }),
  paper("foundation-published", { tracks: ["foundation", "language"] }),
  paper("foundation-preprint", { status: "preprint", source: "arXiv", sources: ["arXiv"], firstSeenAt: "2026-09-17T03:00:00Z", publishedAt: "2026-09-17" }),
  paper("foundation-unknown", { status: "unknown", firstSeenAt: "2026-09-18T02:00:00Z", publishedAt: "2026-09-18" }),
  paper("diagnosis", { tracks: ["diagnosis"], tasks: ["diagnosis"] }),
  paper("future", { publishedAt: "2026-10-01" }),
]);

test("new interest filtering controls status counts, trends, matrix and drill record IDs", () => {
  const result = buildDashboard(sample(), [], { ...defaultDashboardFilters, track: "foundation", days: "7" }, now);
  assert.deepEqual(result.rows.map(p => p.id), ["foundation-published", "foundation-preprint", "foundation-unknown"]);
  assert.equal(result.published.length, 1);
  assert.equal(result.preprints.length, 1);
  assert.equal(result.status.find(s => s.key === "unknown")?.count, 1);
  assert.equal(result.trend.reduce((sum, row) => sum + row.all, 0), result.rows.length);
  assert.equal(result.trend.reduce((sum, row) => sum + row.published, 0), 1);
  assert.equal(result.trend.reduce((sum, row) => sum + row.preprint, 0), 1);
  assert.deepEqual(new Set(result.trend.flatMap(row => row.ids)), new Set(result.rows.map(p => p.id)));
  assert.equal(result.matrix.find(row => row.task === "segmentation")?.cells.find(cell => cell.modality === "MRI")?.papers.length, 3);
  assert.equal(result.futureCount, 1);
});

test("ten interest counts disclose overlapping membership without duplicating totals", () => {
  const result = buildDashboard(sample(), [], { ...defaultDashboardFilters, days: "7", source: "Europe PMC" }, now);
  assert.equal(result.directions.length, 10);
  assert.deepEqual(result.directions.map(d => d.id), Object.keys(TRACKS));
  assert.equal(result.rows.length, 3);
  assert.equal(result.directions.find(d => d.id === "foundation")?.papers.length, 2);
  assert.equal(result.directions.find(d => d.id === "language")?.papers.length, 1);
  assert.equal(result.directions.find(d => d.id === "diagnosis")?.papers.length, 1);
  assert.equal(result.directions.reduce((sum, d) => sum + d.papers.length, 0), 4);
  for (const direction of result.directions) {
    assert.ok(direction.papers.every(p => result.rows.includes(p)));
  }
});

test("discovery history stays anchored to the initial import after later refreshes", () => {
  const data = sample();
  const result = buildDashboard(data, [], { ...defaultDashboardFilters, clock: "discovery", days: "all" }, now);
  assert.equal(result.initialCount, 1);
  assert.ok(!result.rows.some(p => p.id === "initial"));
  assert.ok(result.trend.some(day => day.date === "2026-09-16" && day.ids.includes("foundation-published")));
  assert.ok(result.trend.some(day => day.date === "2026-09-17" && day.ids.includes("foundation-preprint")));
  assert.equal(result.newToday.length, 1);
  assert.equal(result.trend.reduce((sum, row) => sum + row.all, 0), result.rows.length);
  const refreshed = buildDashboard({ ...data, collectedAt: "2026-09-19T04:00:00Z" }, [], { ...defaultDashboardFilters, clock: "discovery", days: "all" }, now);
  assert.deepEqual(refreshed.trend, result.trend);
  assert.equal(refreshed.initialCount, result.initialCount);
});

test("source and interest intersection remains consistent in every date bucket", () => {
  const result = buildDashboard(sample(), [], { ...defaultDashboardFilters, track: "foundation", source: "arXiv", days: "7" }, now);
  assert.deepEqual(result.rows.map(p => p.id), ["foundation-preprint"]);
  assert.equal(result.trend.reduce((sum, row) => sum + row.all, 0), 1);
  assert.equal(result.trend.reduce((sum, row) => sum + row.preprint, 0), 1);
  assert.equal(result.trend.reduce((sum, row) => sum + row.published, 0), 0);
});


test("source health distinguishes request failures from retrieval limits and preserves the last real success", () => {
  const run = (source: string, completedAt: string, overrides: Partial<SyncRun> = {}): SyncRun => ({
    id: `${source}-${completedAt}`, source, startedAt: completedAt, completedAt, status: "ok",
    received: 10, kept: 10, added: 0, updated: 0, total: 10, query: "test", dateFrom: "", dateTo: "2026-09-18", coverage: "test", ...overrides,
  });
  const data = sample();
  const successfulAt = "2026-09-18T01:00:00Z";
  // Runs are deliberately not in order: the most recent attempt must determine health.
  data.runs = [
    run("Europe PMC", successfulAt),
    run("Europe PMC", "2026-09-18T03:00:00Z", { status: "partial", error: "HTTP 503" }),
    run("arXiv", "2026-09-18T03:00:00Z", { status: "partial", total: 1000, coverage: "retrieval cap" }),
    run("medRxiv", "2026-09-18T03:00:00Z", { status: "error", error: "HTTP 503", received: 0, kept: 0 }),
  ];
  const sources = buildDashboard(data, [], defaultDashboardFilters, now).sources;
  const europe = sources.find(s => s.name === "Europe PMC")!;
  assert.equal(europe.state, "部分失败");
  assert.equal(europe.warning, true);
  assert.equal(europe.limited, false);
  assert.equal(europe.updatedAt, successfulAt);
  const arxiv = sources.find(s => s.name === "arXiv")!;
  assert.equal(arxiv.state, "有限覆盖");
  assert.equal(arxiv.warning, false);
  assert.equal(arxiv.limited, true);
  assert.equal(arxiv.updatedAt, "2026-09-18T03:00:00Z");
  const medrxiv = sources.find(s => s.name === "medRxiv")!;
  assert.equal(medrxiv.state, "同步失败");
  assert.equal(medrxiv.updatedAt, null);
  const noRuns = buildDashboard(sample(), [], defaultDashboardFilters, now).sources;
  assert.ok(noRuns.every(s => s.updatedAt === null));
});

test("Beijing dates cross midnight independently of UTC and keep invalid dates empty", () => {
  assert.equal(beijingDay("2026-09-17T15:59:59.999Z"), "2026-09-17");
  assert.equal(beijingDay(new Date("2026-09-17T16:00:00.000Z")), "2026-09-18");
  assert.equal(beijingDay("not a date"), "");
  const data = dataset([
    paper("initial", {firstSeenAt: "2026-09-10T00:00:00Z"}),
    paper("before", {firstSeenAt: "2026-09-17T15:59:59.999Z"}),
    paper("after", {firstSeenAt: "2026-09-17T16:00:00.000Z"}),
  ]);
  const result = buildDashboard(data, [], {...defaultDashboardFilters, clock: "discovery", days: "1"}, now);
  assert.deepEqual(result.rows.map(row => row.id), ["after"]);
  assert.deepEqual(result.newToday.map(row => row.id), ["after"]);
});

test("matrix keeps fixed axes, input order and single membership for repeated tags", () => {
  const records = [
    paper("multi", {tasks: ["diagnosis", "segmentation", "segmentation"], modalities: ["CT", "MRI", "MRI"]}),
    paper("untagged", {tasks: ["segmentation"], modalities: []}),
    paper("foreign-tags", {tasks: ["segmentation", "not-a-task"], modalities: ["unlisted modality", "未识别"]}),
    paper("last", {tasks: ["segmentation"], modalities: ["MRI"]}),
  ];
  const result = buildDashboard(dataset(records), [], defaultDashboardFilters, now);
  assert.deepEqual(result.matrix.map(row => row.task), Object.keys(TASKS));
  const segmentation = result.matrix.find(row => row.task === "segmentation")!;
  assert.deepEqual(segmentation.cells.map(cell => cell.modality), result.modalities);
  assert.deepEqual(segmentation.cells.find(cell => cell.modality === "MRI")!.papers.map(row => row.id), ["multi", "last"]);
  assert.deepEqual(segmentation.cells.find(cell => cell.modality === "CT")!.papers.map(row => row.id), ["multi"]);
  assert.deepEqual(segmentation.cells.find(cell => cell.modality === "未识别")!.papers.map(row => row.id), ["untagged"]);
  assert.equal(segmentation.cells.find(cell => cell.modality === "MRI")!.papers[0], records[0]);
  assert.deepEqual(result.matrix.find(row => row.task === "diagnosis")!.cells.find(cell => cell.modality === "MRI")!.papers.map(row => row.id), ["multi"]);
});

test("source-only refresh preserves the strict 24-hour stale boundary within the same Beijing day", () => {
  const completedAt = "2026-09-17T04:00:00.000Z";
  const data = dataset([]);
  data.runs = [{id: "success", source: "Europe PMC", startedAt: completedAt, completedAt, status: "ok", received: 0, kept: 0, added: 0, updated: 0, total: 0, query: "test", dateFrom: "", dateTo: "2026-09-17", coverage: "test"}];
  const atBoundary = buildSourceHealth(data, new Date("2026-09-18T04:00:00.000Z"));
  const afterBoundary = buildSourceHealth(data, new Date("2026-09-18T04:00:00.001Z"));
  assert.equal(atBoundary[0].state, "窗口采集完成");
  assert.equal(atBoundary[0].warning, false);
  assert.equal(afterBoundary[0].state, "超过 24 小时");
  assert.equal(afterBoundary[0].warning, true);
  assert.deepEqual(atBoundary, buildDashboard(data, [], defaultDashboardFilters, now).sources);
});

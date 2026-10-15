import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GitHubSignal, ResearchSignal } from "../lib/research-signals";
import { buildGitHubDashboard, type GitHubDashboardModel } from "../lib/github-dashboard";

const now = "2026-10-15T10:00:00.000Z";
function repo(id: string, firstSeenAt: string, overrides: Partial<GitHubSignal> = {}): GitHubSignal {
  return { id, kind: "github", title: id, fullName: `lab/${id}`, url: `https://github.com/lab/${id}`, summary: "Medical imaging",
    summaryKind: "repository-description", publisher: "lab", publishedAt: "2020-01-01T00:00:00Z", firstSeenAt,
    observedAt: now, updatedAt: now, topics: [], sourceId: "github-public", relatedUrls: [], stars: 0, forks: 0,
    openIssues: 0, license: null, language: null, archived: false, pushedAt: null, releasedAt: null, releaseUrl: null,
    readmeExcerpt: "", relevance: { level: "direct", reasons: ["medical-imaging"] }, ...overrides };
}
function sortedIds(records: readonly { id: string }[]): string[] { return records.map(record => record.id).sort(); }
function assertReconciled(model: GitHubDashboardModel, baseCount: number): void {
  assert.equal(model.rows.length + Object.values(model.excluded).reduce((n, row) => n + row.count, 0), baseCount);
  assert.deepEqual(model.series.flatMap(row => row.recordIds).sort(), sortedIds(model.rows));
  for (const row of model.series) {
    assert.equal(row.count, row.observed ? row.recordIds.length : null);
    assert.equal(row.direct, row.observed ? row.directRecordIds.length : null);
    assert.equal(row.candidate, row.observed ? row.candidateRecordIds.length : null);
    if (row.observed) assert.equal(row.count, row.direct! + row.candidate!);
  }
}

test("earliest full-library batch is a stable inferred baseline, not the earliest filtered result", () => {
  const first = repo("initial", "2026-10-14T15:03:00Z");
  const equivalent = repo("same-batch", "2026-10-14T23:03:00+08:00");
  const later = repo("later", "2026-10-14T15:06:00Z");
  const today = repo("today", "2026-10-14T20:00:00Z");
  const records = [first, equivalent, later, today];
  const full = buildGitHubDashboard(records, {}, now, now);
  const filtered = buildGitHubDashboard(records, { baseRecords: [today] }, now, now);
  assert.equal(full.initialAt, "2026-10-14T15:03:00.000Z");
  assert.deepEqual(full.global.initial.recordIds, ["initial", "same-batch"]);
  assert.deepEqual(filtered.global, full.global);
  assert.equal(filtered.initialInScope.count, 0);
  assert.deepEqual(sortedIds(filtered.rows), ["today"]);
  assert.deepEqual(sortedIds(full.rows), ["later", "today"]);
  assert.equal(full.observedFrom, "2026-10-14");
  assert.equal(full.series.length, 2, "30-day selection must not invent 28 days before observation");
  assertReconciled(full, 4);
});

test("global totals and today ignore UI filters, deduplicate IDs, and isolate GitHub records", () => {
  const initial = repo("initial", "2026-10-13T00:00:00Z");
  const today = repo("today", "2026-10-14T16:00:00Z");
  const candidate = repo("candidate", "2026-10-15T00:00:00Z", { relevance: { level: "candidate", reasons: ["review"] } });
  const fakeNews = { ...today, id: "news", kind: "news" } as unknown as ResearchSignal;
  const model = buildGitHubDashboard([initial, today, candidate, today, fakeNews], { baseRecords: [today, today, repo("not-in-library", now)] }, now, now);
  assert.equal(model.global.total.count, 3);
  assert.deepEqual(model.global.today.recordIds, ["today", "candidate"]);
  assert.deepEqual(sortedIds(model.rows), ["today"]);
  assertReconciled(model, 1);
});

test("today and window cutoffs use Beijing midnight, with exact-time future dates excluded", () => {
  const records = [repo("initial", "2026-09-01T00:00:00Z"),
    repo("cutoff", "2026-10-08T16:00:00Z"), repo("before-cutoff", "2026-10-08T15:59:59.999Z"),
    repo("before-today", "2026-10-14T15:59:59.999Z"), repo("today-midnight", "2026-10-14T16:00:00Z"),
    repo("now", now), repo("future", "2026-10-15T10:00:00.001Z")];
  const model = buildGitHubDashboard(records, { range: 7 }, now, now);
  assert.equal(model.today, "2026-10-15");
  assert.equal(model.start, "2026-10-09");
  assert.deepEqual(sortedIds(model.rows), ["before-today", "cutoff", "now", "today-midnight"]);
  assert.deepEqual(model.global.today.recordIds, ["today-midnight", "now"]);
  assert.deepEqual(model.excluded.future.recordIds, ["future"]);
  assert.equal(model.series.at(-1)!.isToday, true);
  assertReconciled(model, records.length);
});

test("a stale snapshot does not turn yesterday into today or fabricate zero new records for unobserved days", () => {
  const records = [repo("initial", "2026-10-13T00:00:00Z"), repo("yesterday", "2026-10-14T00:00:00Z")];
  const model = buildGitHubDashboard(records, { range: 7 }, now, "2026-10-14T15:00:00Z");
  assert.equal(model.today, "2026-10-15");
  assert.equal(model.snapshotDay, "2026-10-14");
  assert.equal(model.snapshotStale, true);
  assert.equal(model.global.today.count, 0);
  assert.equal(model.observedTo, "2026-10-14");
  assert.deepEqual(model.series.at(-1), { date: "2026-10-15", count: null, direct: null, candidate: null,
    recordIds: [], directRecordIds: [], candidateRecordIds: [], observed: false, isToday: true });
  assertReconciled(model, records.length);
});

test("initial records are excluded only in discovery mode and remain available through explicit full-library scope", () => {
  const records = [repo("initial", "2026-10-14T00:00:00Z", { pushedAt: "2026-10-10T00:00:00Z" }),
    repo("later", "2026-10-15T00:00:00Z", { pushedAt: "2026-10-11T00:00:00Z" })];
  const all = buildGitHubDashboard(records, { range: "all" }, now, now);
  assert.deepEqual(sortedIds(all.rows), ["later"]);
  const included = buildGitHubDashboard(records, { range: "all", includeInitial: true }, now, now);
  assert.deepEqual(sortedIds(included.rows), ["initial", "later"]);
  const activity = buildGitHubDashboard(records, { range: 7, clock: "activity" }, now, now);
  assert.deepEqual(sortedIds(activity.rows), ["initial", "later"]);
  assert.equal(activity.observedFrom, "2026-10-09", "historical repository activity can predate monitor observation");
  assert.equal(activity.excluded.initial.count, 0);
  assertReconciled(activity, records.length);
});

test("activity is latest repository metadata, while discovery tracks ingestion including backfilled old repositories", () => {
  const records = [repo("initial", "2026-10-13T00:00:00Z"),
    repo("backfilled", "2026-10-14T16:00:00Z", { pushedAt: "2020-01-01T00:00:00Z" }),
    repo("released", "2026-10-14T20:00:00Z", { pushedAt: "2026-09-01T00:00:00Z", releasedAt: "2026-10-14T16:00:00Z" })];
  const discovery = buildGitHubDashboard(records, { range: 7 }, now, now);
  assert.deepEqual(sortedIds(discovery.rows), ["backfilled", "released"]);
  const activity = buildGitHubDashboard(records, { range: 7, clock: "activity" }, now, now);
  assert.deepEqual(sortedIds(activity.rows), ["released"]);
  assert.equal(activity.series.find(row => row.date === "2026-10-15")!.count, 1);
});

test("custom dates are inclusive Beijing dates, clamp future end days, and reject malformed or reversed windows", () => {
  const records = [repo("initial", "2026-10-12T00:00:00Z"), repo("inside", "2026-10-13T16:00:00Z"), repo("outside", "2026-10-14T16:00:00Z")];
  const custom = buildGitHubDashboard(records, { range: "custom", from: "2026-10-14", to: "2026-10-14" }, now, now);
  assert.deepEqual(sortedIds(custom.rows), ["inside"]);
  assert.equal(custom.series.length, 1);
  assert.equal(custom.series[0].isToday, false);
  assert.equal(buildGitHubDashboard(records, { range: "custom", from: "2026-10-14", to: "2026-11-01" }, now, now).end, "2026-10-15");
  for (const [from, to] of [["2026-02-30", "2026-10-15"], ["2026-10-15", "2026-10-14"], ["", "2026-10-15"], ["2027-01-01", "2027-01-02"]]) {
    const invalid = buildGitHubDashboard(records, { range: "custom", from, to }, now, now);
    assert.equal(invalid.rangeValid, false);
    assert.equal(invalid.rows.length, 0);
    assert.equal(invalid.series.length, 0);
    assertReconciled(invalid, records.length);
  }
});

test("invalid snapshot and current clocks fail closed; missing dates remain distinguishable", () => {
  const records = [repo("initial", "2026-10-13T00:00:00Z"), repo("valid", "2026-10-14T20:00:00Z"), repo("missing", ""), repo("invalid", "2026-02-30T00:00:00Z")];
  for (const [current, snapshot] of [[now, "not-a-date"], ["not-a-date", now], [now, "2026-02-30T00:00:00Z"]]) {
    const model = buildGitHubDashboard(records, {}, current, snapshot);
    assert.equal(model.global.total.count, 4);
    assert.equal(model.global.today.count, 0);
    assert.equal(model.rows.length, 0);
    assert.equal(model.series.length, 0);
    assert.deepEqual(model.excluded.missing.recordIds, ["missing", "invalid"]);
    assert.deepEqual(model.excluded.unavailable.recordIds, ["initial", "valid"]);
    assertReconciled(model, records.length);
  }
});

test("timeline retains a single-day spike, unknown relevance is review-needed, and missing days are captured zeros only", () => {
  const records = [repo("initial", "2026-10-12T00:00:00Z"),
    ...Array.from({ length: 100 }, (_, index) => repo(`spike-${index}`, "2026-10-14T00:00:00Z", { relevance: index < 75 ? { level: "direct", reasons: ["direct"] } : undefined }))];
  const model = buildGitHubDashboard(records, {}, now, now);
  assert.deepEqual(model.series.map(({ date, count, direct, candidate }) => ({ date, count, direct, candidate })), [
    { date: "2026-10-12", count: 0, direct: 0, candidate: 0 }, { date: "2026-10-13", count: 0, direct: 0, candidate: 0 },
    { date: "2026-10-14", count: 100, direct: 75, candidate: 25 }, { date: "2026-10-15", count: 0, direct: 0, candidate: 0 },
  ]);
  assertReconciled(model, records.length);
});

test("reused metadata metrics and month buckets follow Beijing boundaries too", () => {
  const records = [repo("initial", "2026-09-01T00:00:00Z"), repo("beijing-cutoff", "2026-10-14T00:00:00Z", { pushedAt: "2026-07-17T16:00:00Z" }),
    repo("before-cutoff", "2026-10-14T00:00:00Z", { pushedAt: "2026-07-17T15:59:59Z" }),
    repo("beijing-month", "2026-10-14T00:00:00Z", { pushedAt: "2026-09-30T16:00:00Z" })];
  const model = buildGitHubDashboard(records, {}, now, now);
  assert.deepEqual(model.scoped.metrics.find(row => row.id === "recent90")!.recordIds.sort(), ["beijing-cutoff", "beijing-month"]);
  assert.deepEqual(model.scoped.timeline.months.find(row => row.id === "2026-10")!.recordIds, ["beijing-month"]);
  assert.equal(model.scoped.asOf, now);
});

test("future snapshot cannot admit records later than the browser clock", () => {
  const records = [repo("initial", "2026-10-13T00:00:00Z"), repo("future", "2026-10-15T10:00:00.001Z"),
    repo("future-activity", "2026-10-15T00:00:00Z", { pushedAt: "2026-10-15T12:00:00Z" })];
  const model = buildGitHubDashboard(records, {}, now, "2026-10-16T00:00:00Z");
  assert.equal(model.snapshotInFuture, true);
  assert.deepEqual(model.global.today.recordIds, ["future-activity"]);
  assert.deepEqual(model.excluded.future.recordIds, ["future"]);
  assert.deepEqual(model.scoped.metrics.find(row => row.id === "recent90")!.recordIds, []);
  assert.equal(model.end, "2026-10-15");
  assertReconciled(model, records.length);
});

test("long history uses monthly points while retaining exact window boundaries and every record ID", () => {
  const records = [repo("initial", "2026-01-01T00:00:00Z", { publishedAt: "2008-01-01T00:00:00Z", pushedAt: "2008-10-01T00:00:00Z" }),
    repo("old", "2026-01-02T00:00:00Z", { publishedAt: "2008-01-01T00:00:00Z", pushedAt: "2008-11-01T00:00:00Z" }),
    repo("june", "2026-06-01T00:00:00Z", { pushedAt: "2026-06-01T00:00:00Z" }),
    repo("now", "2026-10-15T00:00:00Z", { pushedAt: "2026-10-15T00:00:00Z" })];
  const activity = buildGitHubDashboard(records, { range: "all", clock: "activity" }, now, now);
  assert.equal(activity.seriesGranularity, "month");
  assert.equal(activity.series[0].date, "2008-10");
  assert.equal(activity.series.at(-1)!.date, "2026-10");
  assert.equal(activity.series.at(-1)!.isToday, true);
  assert(activity.series.length < 250, "long timelines must not generate thousands of daily points");
  assertReconciled(activity, records.length);
  const custom = buildGitHubDashboard(records, { range: "custom", from: "2026-01-15", to: "2026-10-14" }, now, now);
  assert.equal(custom.seriesGranularity, "month");
  assert.deepEqual(sortedIds(custom.rows), ["june"]);
  assertReconciled(custom, records.length);
  const stale = buildGitHubDashboard(records, { range: "all" }, now, "2026-08-15T00:00:00Z");
  assert.equal(stale.seriesGranularity, "month");
  assert.equal(stale.series.find(point => point.date === "2026-08")!.count, 0);
  assert.equal(stale.series.find(point => point.date === "2026-09")!.count, null);
  assert.equal(stale.series.find(point => point.date === "2026-10")!.count, null);
  assertReconciled(stale, records.length);
  assert.equal(buildGitHubDashboard(records, { range: 90 }, now, now).seriesGranularity, "day");
});

test("real archive populations reconcile without freezing counts as collection expands", () => {
  const data = JSON.parse(readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8")) as { generatedAt: string; records: ResearchSignal[] };
  const github = data.records.filter(record => record.kind === "github");
  const model = buildGitHubDashboard(data.records, { range: "all" }, data.generatedAt, data.generatedAt);
  assert.equal(model.global.total.count, new Set(github.map(record => record.id)).size);
  assert(model.global.initial.count > 0);
  assert.equal(model.rows.length + model.global.initial.count, model.global.total.count);
  assertReconciled(model, github.length);
  const direct = buildGitHubDashboard(data.records, { baseRecords: github.filter(record => record.relevance?.level === "direct"), range: "all" }, data.generatedAt, data.generatedAt);
  assert.deepEqual(direct.global, model.global);
  assert(direct.series.every(row => row.candidate === 0));
});

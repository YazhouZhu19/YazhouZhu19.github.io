import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NewsSignal, ResearchSignal, ResearchSignalsData, SignalSourceState } from "../lib/research-signals";
import { buildNewsDashboard, newsDashboardAsOf, newsDashboardDate, type NewsDashboardModel } from "../lib/news-dashboard";

const now = "2026-10-15T10:00:00.000Z";
function news(id: string, firstSeenAt: string, overrides: Partial<NewsSignal> = {}): NewsSignal {
  return { id, kind: "news", title: `Medical imaging ${id}`, url: `https://example.com/${id}`, summary: "Medical imaging progress",
    summaryKind: "search-snippet", publisher: "Example Research", publishedAt: firstSeenAt, firstSeenAt,
    observedAt: now, updatedAt: null, topics: [], sourceId: "google-news-imaging", relatedUrls: [], newsType: "research",
    originalUrl: null, discoveryUrl: "https://news.google.com/rss/search?q=medical-imaging",
    relevance: { level: "direct", reasons: ["medical-imaging"] }, ...overrides };
}
function sortedIds(records: readonly { id: string }[]): string[] { return records.map(record => record.id).sort(); }
function source(overrides: Partial<SignalSourceState> = {}): SignalSourceState {
  return { id: "google-news-imaging", name: "Google News", kind: "news", url: "https://news.google.com/rss/search?q=medical-imaging",
    status: "ok", checkedAt: now, lastSuccessAt: now, received: 0, retained: 0, error: null, coverage: "Public search", ...overrides };
}
function snapshot(generatedAt: string, records: ResearchSignal[] = [], sources: SignalSourceState[] = []): ResearchSignalsData {
  return { schemaVersion: 1, generatedAt, records, sources, limitations: [] };
}
function assertReconciled(model: NewsDashboardModel, baseCount: number): void {
  assert.equal(model.rows.length + Object.values(model.excluded).reduce((n, row) => n + row.count, 0), baseCount);
  assert.deepEqual(model.series.flatMap(row => row.recordIds).sort(), sortedIds(model.rows));
  for (const row of model.series) {
    assert.equal(row.count, row.observed ? row.recordIds.length : null);
    assert.equal(row.direct, row.observed ? row.directRecordIds.length : null);
    assert.equal(row.candidate, row.observed ? row.candidateRecordIds.length : null);
    if (row.observed) assert.equal(row.count, row.direct! + row.candidate!);
  }
  for (const partition of [model.scoped.newsTypes, model.scoped.publishers]) {
    assert.deepEqual(partition.flatMap(row => row.recordIds).sort(), sortedIds(model.rows));
    assert.equal(partition.reduce((sum, row) => sum + row.count, 0), model.rows.length);
  }
}

test("publication is the default 30-day clock and retains the initial collection batch", () => {
  const records = Object.freeze([news("initial", "2026-10-14T00:00:00Z", { publishedAt: "2026-09-20T00:00:00Z" }),
    news("recent", "2026-10-15T00:00:00Z", { publishedAt: "2026-10-10T00:00:00Z" })]);
  const model = buildNewsDashboard(records, {}, now, now);
  assert.deepEqual(model.filters, { range: 30, clock: "publication" });
  assert.equal(model.start, "2026-09-16");
  assert.equal(model.observedFrom, "2026-09-16");
  assert.deepEqual(sortedIds(model.rows), ["initial", "recent"]);
  assert.equal(model.excluded.initial.count, 0);
  assert.equal(model.series.length, 30);
  assert.deepEqual(model.scoped.metrics.map(metric => metric.id), ["total", "publishers", "model", "tooling"]);
  assert.deepEqual(records.map(record => record.id), ["initial", "recent"]);
  assertReconciled(model, 2);
});

test("global counts and baseline remain stable across common filters, source isolation, and duplicate IDs", () => {
  const initial = news("initial", "2026-10-13T00:00:00Z");
  const today = news("today", "2026-10-14T16:00:00Z");
  const candidate = news("candidate", "2026-10-15T00:00:00Z", { relevance: { level: "candidate", reasons: ["review"] } });
  const github = { ...today, id: "github", kind: "github" } as unknown as ResearchSignal;
  const all = [initial, today, candidate, today, github];
  const full = buildNewsDashboard(all, {}, now, now);
  const filtered = buildNewsDashboard(all, { baseRecords: [today, today, news("not-in-library", now)] }, now, now);
  assert.equal(full.global.total.count, 3);
  assert.deepEqual(full.global.today.recordIds, ["today", "candidate"]);
  assert.deepEqual(filtered.global, full.global);
  assert.deepEqual(sortedIds(filtered.rows), ["today"]);
  assertReconciled(filtered, 1);
});

test("discovery excludes only the earliest exact full-library batch and never re-infers a filtered baseline", () => {
  const initial = news("initial", "2026-10-14T15:00:00Z");
  const same = news("same", "2026-10-14T23:00:00+08:00");
  const later = news("later", "2026-10-14T15:01:00Z");
  const today = news("today", "2026-10-14T16:00:00Z");
  const records = [initial, same, later, today];
  const full = buildNewsDashboard(records, { clock: "discovery" }, now, now);
  const filtered = buildNewsDashboard(records, { clock: "discovery", baseRecords: [today] }, now, now);
  assert.equal(full.initialAt, "2026-10-14T15:00:00.000Z");
  assert.deepEqual(full.excluded.initial.recordIds, ["initial", "same"]);
  assert.deepEqual(sortedIds(full.rows), ["later", "today"]);
  assert.deepEqual(filtered.global, full.global);
  assert.deepEqual(sortedIds(filtered.rows), ["today"]);
  assert.equal(filtered.initialInScope.count, 0);
  assert.equal(full.observedFrom, "2026-10-14");
  assert.equal(full.series.length, 2, "there are no artificial zeros before collection began");
  assertReconciled(full, 4);
});

test("publication and discovery dates are independent and never substitute for missing metadata", () => {
  const old = news("backfill", "2026-10-14T00:00:00Z", { publishedAt: "2020-01-01T00:00:00Z" });
  const records = [news("baseline", "2026-10-13T00:00:00Z"), old,
    news("missing-publication", "2026-10-15T00:00:00Z", { publishedAt: null }),
    news("missing-discovery", "", { publishedAt: "2026-10-14T00:00:00Z" })];
  const publication = buildNewsDashboard(records, { range: 7 }, now, now);
  const discovery = buildNewsDashboard(records, { range: 7, clock: "discovery" }, now, now);
  assert.deepEqual(sortedIds(publication.rows), ["baseline", "missing-discovery"]);
  assert.deepEqual(sortedIds(discovery.rows), ["backfill", "missing-publication"]);
  assert.equal(newsDashboardDate(records[2], "publication"), null);
  assert.equal(newsDashboardDate(records[3], "discovery"), null);
  assert.equal(newsDashboardDate(old, "publication"), "2020-01-01T00:00:00.000Z");
  assert.equal(newsDashboardDate(news("offset", "2026-10-15T00:00:00+08:00"), "publication"), "2026-10-14T16:00:00.000Z");
  assert.deepEqual(publication.global, discovery.global);
  assertReconciled(publication, 4); assertReconciled(discovery, 4);
});

test("both clocks and today's intake use Beijing midnight and exact-time future exclusion", () => {
  const records = [news("baseline", "2026-09-01T00:00:00Z"),
    news("cutoff", "2026-10-08T16:00:00Z"), news("before-cutoff", "2026-10-08T15:59:59.999Z"),
    news("yesterday", "2026-10-14T15:59:59.999Z"), news("today-midnight", "2026-10-14T16:00:00Z"),
    news("now", now), news("future", "2026-10-15T10:00:00.001Z")];
  for (const clock of ["publication", "discovery"] as const) {
    const model = buildNewsDashboard(records, { range: 7, clock }, now, now);
    assert.equal(model.start, "2026-10-09");
    assert.deepEqual(sortedIds(model.rows), ["cutoff", "now", "today-midnight", "yesterday"]);
    assert.deepEqual(model.global.today.recordIds, ["today-midnight", "now"]);
    assert.deepEqual(model.excluded.future.recordIds, ["future"]);
    assert.equal(model.series.at(-1)!.isToday, true);
    assertReconciled(model, records.length);
  }
});

test("stale snapshots leave later days unobserved instead of moving today's date or filling zeros", () => {
  const records = [news("baseline", "2026-10-13T00:00:00Z"), news("yesterday", "2026-10-14T00:00:00Z")];
  for (const clock of ["publication", "discovery"] as const) {
    const model = buildNewsDashboard(records, { range: 7, clock }, now, "2026-10-14T15:00:00Z");
    assert.equal(model.today, "2026-10-15"); assert.equal(model.snapshotDay, "2026-10-14");
    assert.equal(model.snapshotStale, true); assert.equal(model.global.today.count, 0);
    assert.deepEqual(model.series.at(-1), { date: "2026-10-15", count: null, direct: null, candidate: null,
      recordIds: [], directRecordIds: [], candidateRecordIds: [], observed: false, isToday: true });
    assertReconciled(model, records.length);
  }
});

test("custom ranges are inclusive, reject impossible dates, and never generate days after now", () => {
  const records = [news("baseline", "2026-10-12T00:00:00Z"), news("inside", "2026-10-13T16:00:00Z"), news("outside", "2026-10-14T16:00:00Z")];
  const model = buildNewsDashboard(records, { range: "custom", from: "2026-10-14", to: "2026-10-14" }, now, now);
  assert.deepEqual(sortedIds(model.rows), ["inside"]); assert.equal(model.series.length, 1);
  assert.equal(model.series[0].isToday, false); assertReconciled(model, 3);
  assert.equal(buildNewsDashboard(records, { range: "custom", from: "2026-10-14", to: "2027-01-01" }, now, now).end, "2026-10-15");
  for (const [from, to] of [["2026-02-30", "2026-10-15"], ["2026-10-15", "2026-10-14"], ["", "2026-10-15"], ["2027-01-01", "2027-01-02"]]) {
    const invalid = buildNewsDashboard(records, { range: "custom", from, to }, now, now);
    assert.equal(invalid.rangeValid, false); assert.equal(invalid.series.length, 0); assert.equal(invalid.rows.length, 0);
    assertReconciled(invalid, 3);
  }
});

test("invalid reference dates fail closed without mislabeling valid source dates as missing", () => {
  const records = [news("valid", "2026-10-14T00:00:00Z"), news("missing", "2026-10-14T01:00:00Z", { publishedAt: null }),
    news("invalid", "2026-10-14T02:00:00Z", { publishedAt: "2026-02-30T00:00:00Z" })];
  for (const [current, snapshot] of [[now, "not-a-date"], ["not-a-date", now], [now, "2026-02-30T00:00:00Z"]]) {
    const model = buildNewsDashboard(records, {}, current, snapshot);
    assert.equal(model.global.total.count, 3); assert.equal(model.global.today.count, 0);
    assert.equal(model.rows.length, 0); assert.equal(model.series.length, 0);
    assert.deepEqual(model.excluded.missing.recordIds, ["missing", "invalid"]);
    assert.deepEqual(model.excluded.unavailable.recordIds, ["valid"]);
    assertReconciled(model, 3);
  }
});

test("single-day spikes and relevance partitions retain all record IDs without smoothing", () => {
  const records = [news("initial", "2026-10-12T00:00:00Z"),
    ...Array.from({ length: 100 }, (_, index) => news(`spike-${index}`, "2026-10-14T00:00:00Z", { relevance: index < 75 ? { level: "direct", reasons: ["direct"] } : undefined }))];
  const model = buildNewsDashboard(records, { range: "custom", from: "2026-10-12", to: "2026-10-15", clock: "discovery" }, now, now);
  assert.deepEqual(model.series.map(({ count, direct, candidate }) => ({ count, direct, candidate })), [
    { count: 0, direct: 0, candidate: 0 }, { count: 0, direct: 0, candidate: 0 },
    { count: 100, direct: 75, candidate: 25 }, { count: 0, direct: 0, candidate: 0 },
  ]);
  assertReconciled(model, 101);
});

test("long windows aggregate by month after exact date filtering and keep unobserved full months null", () => {
  const records = [news("initial", "2026-01-01T00:00:00Z", { publishedAt: "2015-01-01T00:00:00Z" }),
    news("old", "2026-01-02T00:00:00Z", { publishedAt: "2015-02-01T00:00:00Z" }),
    news("june", "2026-06-01T00:00:00Z"), news("now", "2026-10-15T00:00:00Z")];
  const model = buildNewsDashboard(records, { range: "all" }, now, now);
  assert.equal(model.seriesGranularity, "month"); assert.equal(model.series[0].date, "2015-01");
  assert.equal(model.series.at(-1)!.date, "2026-10"); assert.equal(model.series.at(-1)!.isToday, true);
  assert(model.series.length < 150); assertReconciled(model, 4);
  const custom = buildNewsDashboard(records, { range: "custom", from: "2026-01-15", to: "2026-10-14" }, now, now);
  assert.equal(custom.seriesGranularity, "month"); assert.deepEqual(sortedIds(custom.rows), ["june"]); assertReconciled(custom, 4);
  const stale = buildNewsDashboard(records, { range: "all", clock: "discovery" }, now, "2026-08-15T00:00:00Z");
  assert.equal(stale.seriesGranularity, "month"); assert.equal(stale.series.find(point => point.date === "2026-08")!.count, 0);
  assert.equal(stale.series.find(point => point.date === "2026-09")!.count, null); assert.equal(stale.series.find(point => point.date === "2026-10")!.count, null);
  assertReconciled(stale, 4);
  assert.equal(buildNewsDashboard(records, { range: 90 }, now, now).seriesGranularity, "day");
});

test("scoped metrics count distinct publisher names and model/tooling records from the same population", () => {
  const records = [news("model", "2026-10-12T00:00:00Z", { publisher: " Lab A ", newsType: "model", discoveryGroups: ["pathology", "microscopy"] }),
    news("research", "2026-10-13T00:00:00Z", { publisher: "lab a", newsType: "research", discoveryGroups: ["foundation-models", "vision-language"] }),
    news("tool", "2026-10-14T00:00:00Z", { publisher: "Lab B", newsType: "tooling" }),
    news("unknown", "2026-10-15T00:00:00Z", { publisher: "Unknown" })];
  const model = buildNewsDashboard(records, {}, now, now);
  assert.deepEqual(model.scoped.metrics.map(({ id, count }) => ({ id, count })), [
    { id: "total", count: 4 }, { id: "publishers", count: 2 }, { id: "model", count: 1 }, { id: "tooling", count: 1 },
  ]);
  assert.equal(model.scoped.metrics.find(metric => metric.id === "publishers")!.recordIds.length, 3, "publisher KPI counts names, while its drilldown contains all named records");
  assert.deepEqual(model.scoped.categories.find(category => category.id === "pathology-microscopy")!.recordIds, ["model"]);
  assert.equal(new Set(model.scoped.categories.flatMap(category => category.recordIds)).size, 4);
  assertReconciled(model, 4);
});

test("scoped source-date bins share Beijing boundaries and future snapshots cannot admit future timestamps", () => {
  const records = [news("initial", "2026-09-01T00:00:00Z"), news("month-edge", "2026-10-14T00:00:00Z", { publishedAt: "2026-09-30T16:00:00Z" }),
    news("future-published", "2026-10-15T00:00:00Z", { publishedAt: "2026-10-15T10:00:00.001Z" }),
    news("future-collected", "2026-10-15T10:00:00.001Z")];
  const publication = buildNewsDashboard(records, { range: "all" }, now, "2026-10-16T00:00:00Z");
  assert.equal(publication.snapshotInFuture, true);
  assert.deepEqual(publication.excluded.future.recordIds, ["future-published", "future-collected"]);
  assert.deepEqual(publication.scoped.timeline.months.find(month => month.id === "2026-10")!.recordIds, ["month-edge"]);
  assert.equal(publication.scoped.asOf, "2026-10-16T00:00:00.000Z");
  const discovery = buildNewsDashboard(records, { range: 30, clock: "discovery" }, now, "2026-10-16T00:00:00Z");
  assert.deepEqual(discovery.excluded.future.recordIds, ["future-collected"]);
  assert.deepEqual(discovery.scoped.timeline.future.recordIds, ["future-published"]);
  assertReconciled(publication, 4); assertReconciled(discovery, 4);
  const onlyFuture = buildNewsDashboard([news("future", "2027-01-01T00:00:00Z")], { range: "all", clock: "discovery" }, now, now);
  assert.equal(onlyFuture.initialAt, null);
  assert.deepEqual(onlyFuture.excluded.future.recordIds, ["future"]);
  assert.deepEqual(onlyFuture.series, []);
  assertReconciled(onlyFuture, 1);
});

test("empty populations and empty custom windows remain valid and do not invent collection history", () => {
  const empty = buildNewsDashboard([], {}, now, now);
  assert.equal(empty.global.total.count, 0); assert.equal(empty.initialAt, null);
  assert(empty.scoped.metrics.every(metric => metric.count === 0)); assertReconciled(empty, 0);
  const discovery = buildNewsDashboard([], { clock: "discovery" }, now, now);
  assert.deepEqual(discovery.series, []); assert.equal(discovery.observedFrom, null);
  const records = [news("initial", "2026-10-14T00:00:00Z"), news("later", "2026-10-15T00:00:00Z")];
  const window = buildNewsDashboard(records, { range: "custom", from: "2026-09-01", to: "2026-09-02" }, now, now);
  assert.equal(window.rangeValid, true); assert.equal(window.rows.length, 0);
  assert.deepEqual(window.series.map(point => point.count), [0, 0]); assertReconciled(window, 2);
});

test("real archive populations reconcile dynamically for both clocks without hardcoded record counts", () => {
  const data = JSON.parse(readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8")) as { generatedAt: string; records: ResearchSignal[] };
  const records = data.records.filter(record => record.kind === "news");
  const full = buildNewsDashboard(data.records, { range: "all" }, data.generatedAt, data.generatedAt);
  assert.equal(full.global.total.count, new Set(records.map(record => record.id)).size);
  assert(full.global.initial.count > 0); assert.equal(full.excluded.initial.count, 0);
  assertReconciled(full, records.length);
  const discovery = buildNewsDashboard(data.records, { range: "all", clock: "discovery" }, data.generatedAt, data.generatedAt);
  assert.deepEqual(discovery.global, full.global);
  assert.deepEqual(discovery.excluded.initial.recordIds, full.global.initial.recordIds);
  assertReconciled(discovery, records.length);
  const direct = buildNewsDashboard(data.records, { baseRecords: records.filter(record => record.relevance?.level === "direct") }, data.generatedAt, data.generatedAt);
  assert.deepEqual(direct.global, full.global); assert(direct.series.every(point => point.candidate === 0));
  assertReconciled(direct, records.filter(record => record.relevance?.level === "direct").length);
});

test("a GitHub-only refresh after Beijing midnight does not advance the news observation day", () => {
  const midnight = "2026-10-15T16:10:00Z", newsObserved = "2026-10-15T15:50:00Z";
  const records = [news("initial", "2026-10-14T00:00:00Z", { observedAt: newsObserved }),
    news("yesterday", "2026-10-15T00:00:00Z", { observedAt: newsObserved })];
  const data = snapshot(midnight, records, [source({ checkedAt: newsObserved, lastSuccessAt: newsObserved }),
    source({ id: "github-public", kind: "github", checkedAt: midnight, lastSuccessAt: midnight })]);
  const cutoff = newsDashboardAsOf(data);
  assert.equal(cutoff, "2026-10-15T15:50:00.000Z");
  const model = buildNewsDashboard(data.records, {}, midnight, cutoff!);
  assert.equal(model.today, "2026-10-16"); assert.equal(model.snapshotDay, "2026-10-15");
  assert.equal(model.snapshotStale, true); assert.equal(model.global.today.count, 0);
  assert.equal(model.series.at(-1)!.date, "2026-10-16");
  assert.equal(model.series.at(-1)!.observed, false); assert.equal(model.series.at(-1)!.count, null);
});

test("failed checks do not advance observation, while records from a partial run can advance it", () => {
  const generatedAt = "2026-10-15T16:10:00Z", previous = "2026-10-15T15:50:00Z", checked = "2026-10-15T16:05:00Z";
  const failed = source({ status: "error", checkedAt: checked, lastSuccessAt: previous, error: "Unavailable" });
  const data = snapshot(generatedAt, [news("old", "2026-10-14T00:00:00Z", { observedAt: previous })], [failed]);
  assert.equal(newsDashboardAsOf(data), "2026-10-15T15:50:00.000Z");
  data.sources[0] = source({ status: "partial", checkedAt: checked, lastSuccessAt: previous });
  assert.equal(newsDashboardAsOf(data), "2026-10-15T15:50:00.000Z");
  data.records.push(news("new", "2026-10-15T16:00:00Z", { observedAt: "2026-10-15T16:00:00Z" }));
  assert.equal(newsDashboardAsOf(data), "2026-10-15T16:00:00.000Z");
});

test("newly configured but unattempted news routes do not create fresh observations", () => {
  const generatedAt = "2026-10-15T16:10:00Z";
  const pending = source({ status: "pending", checkedAt: null, lastSuccessAt: null, received: 0, retained: 0 });
  assert.equal(newsDashboardAsOf(snapshot(generatedAt, [], [pending])), null);
  const previous = "2026-10-15T15:50:00Z";
  assert.equal(newsDashboardAsOf(snapshot(generatedAt, [], [pending, source({ id: "older", checkedAt: previous, lastSuccessAt: previous })])), "2026-10-15T15:50:00.000Z");
});

test("successful empty news searches establish a new observation time without erasing newer evidence", () => {
  const generatedAt = "2026-10-15T16:10:00Z", success = "2026-10-15T16:05:00Z";
  const data = snapshot(generatedAt, [], [source({ checkedAt: success, lastSuccessAt: success }),
    source({ id: "older-query", checkedAt: "2026-10-14T10:00:00Z", lastSuccessAt: "2026-10-14T10:00:00Z" })]);
  assert.equal(newsDashboardAsOf(data), "2026-10-15T16:05:00.000Z", "old queries cannot truncate newer observed news");
  data.sources[0].lastSuccessAt = null;
  assert.equal(newsDashboardAsOf(data), "2026-10-15T16:05:00.000Z", "ok checkedAt is evidence even without a saved lastSuccessAt");
  const model = buildNewsDashboard([], {}, generatedAt, newsDashboardAsOf(data)!);
  assert.equal(model.series.at(-1)!.observed, true); assert.equal(model.series.at(-1)!.count, 0);
});

test("future or invalid source timestamps never expand the cutoff or trigger fallback to the shared snapshot", () => {
  const generatedAt = "2026-10-15T16:10:00Z", valid = "2026-10-15T15:50:00Z", future = "2026-10-16T00:00:00Z";
  const data = snapshot(generatedAt, [news("future", valid, { observedAt: future })], [
    source({ checkedAt: future, lastSuccessAt: future }), source({ id: "valid", checkedAt: "invalid", lastSuccessAt: valid }),
    source({ id: "impossible", checkedAt: "2026-02-30T00:00:00Z", lastSuccessAt: null }),
  ]);
  assert.equal(newsDashboardAsOf(data), "2026-10-15T15:50:00.000Z");
  assert.equal(newsDashboardAsOf(snapshot(generatedAt, [news("future", valid, { observedAt: future })], [source({ checkedAt: future, lastSuccessAt: future })])), null);
  assert.equal(newsDashboardAsOf(snapshot("2026-02-30T00:00:00Z", [], [source()])), null);
  assert.equal(newsDashboardAsOf(snapshot(generatedAt)), null);
  assert.equal(newsDashboardAsOf(null), null);
});

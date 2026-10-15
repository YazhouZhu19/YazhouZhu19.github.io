import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GitHubSignal, NewsSignal, ResearchSignal } from "../lib/research-signals";
import { buildSignalDashboard, signalDashboardDate, type SignalDashboardBucket } from "../lib/signal-dashboard";

const asOf = "2026-10-15T12:00:00.000Z";
function github(id: string, overrides: Partial<GitHubSignal> = {}): GitHubSignal {
  return { id, kind: "github", title: id, url: `https://github.com/lab/${id}`, summary: "Medical imaging toolkit",
    summaryKind: "repository-description", publisher: "lab", publishedAt: "2020-01-01T00:00:00.000Z",
    firstSeenAt: asOf, observedAt: asOf, updatedAt: asOf, topics: [], sourceId: "github-public", relatedUrls: [],
    fullName: `lab/${id}`, stars: 0, forks: 0, openIssues: 0, license: null, language: null, archived: false,
    pushedAt: null, releasedAt: null, releaseUrl: null, readmeExcerpt: "", ...overrides };
}
function news(id: string, overrides: Partial<NewsSignal> = {}): NewsSignal {
  return { id, kind: "news", title: id, url: `https://example.com/${id}`, summary: "Medical imaging news",
    summaryKind: "search-snippet", publisher: "Example Research", publishedAt: asOf,
    firstSeenAt: asOf, observedAt: asOf, updatedAt: asOf, topics: [], sourceId: "google-news-imaging",
    relatedUrls: [], newsType: "research", discoveryUrl: null, originalUrl: null, ...overrides };
}
function ids(rows: SignalDashboardBucket[], id: string): string[] {
  const row = rows.find(item => item.id === id);
  assert(row, `Missing bucket ${id}`);
  return [...row.recordIds].sort();
}
function assertPartition(rows: SignalDashboardBucket[], expected: readonly string[]): void {
  assert.equal(rows.reduce((sum, row) => sum + row.count, 0), expected.length);
  assert.deepEqual(rows.flatMap(row => row.recordIds).sort(), [...expected].sort());
  assert(rows.every(row => row.count === row.recordIds.length));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
}

test("dashboard isolates the requested source and deduplicates IDs without changing the input population", () => {
  const first = github("repo", { discoveryGroups: ["segmentation"], relevance: { level: "candidate", reasons: ["coursework"] } });
  const input = Object.freeze([first, github("repo", { archived: true }), news("story")]);
  const result = buildSignalDashboard(input, "github", asOf);
  assert.equal(result.total, 1);
  assert.deepEqual(result.recordIds, ["repo"]);
  assert.deepEqual(ids(result.categories, "diagnostic-tasks"), ["repo"]);
  assert.deepEqual(ids(result.maintenance, "archived"), []);
  assert.deepEqual(input.map(record => record.id), ["repo", "repo", "story"]);
  assert.equal(buildSignalDashboard(input, "news", asOf).total, 1);
});

test("90-day and 30-day counts include UTC calendar cutoff days and exclude any time after snapshot", () => {
  const githubResult = buildSignalDashboard([
    github("cutoff", { pushedAt: "2026-07-18T00:00:00.000Z" }),
    github("before", { pushedAt: "2026-07-17T23:59:59.999Z" }),
    github("now", { pushedAt: asOf }),
    github("later-today", { pushedAt: "2026-10-15T12:00:00.001Z" }),
    github("future", { pushedAt: "2027-01-01T00:00:00.000Z" }),
    github("missing"),
  ], "github", asOf);
  assert.deepEqual(ids(githubResult.metrics, "recent90"), ["cutoff", "now"]);
  const newsResult = buildSignalDashboard([
    news("cutoff", { publishedAt: "2026-09-16T00:00:00.000Z" }),
    news("before", { publishedAt: "2026-09-15T23:59:59.999Z" }),
    news("now"), news("later-today", { publishedAt: "2026-10-15T12:00:00.001Z" }),
    news("missing", { publishedAt: null }),
  ], "news", asOf);
  assert.deepEqual(ids(newsResult.metrics, "recent30"), ["cutoff", "now"]);
});

test("12-month timeline counts each repository once using its latest valid activity, not the observation date", () => {
  const records = [
    github("release", { publishedAt: "2026-01-01T00:00:00Z", pushedAt: "2026-02-01T00:00:00Z", releasedAt: "2026-03-01T00:00:00Z" }),
    github("push", { publishedAt: "2025-11-01T00:00:00Z", pushedAt: "2026-10-14T00:00:00Z" }),
    github("created", { publishedAt: "2025-11-01T00:00:00Z" }),
    github("older", { publishedAt: "2025-10-31T23:59:59Z" }),
    github("future", { pushedAt: "2026-10-15T12:00:01Z" }),
    github("missing", { publishedAt: null }),
    github("invalid", { publishedAt: "2026-02-30T00:00:00Z", pushedAt: "not-a-date" }),
  ];
  const result = buildSignalDashboard(records, "github", asOf);
  assert.equal(result.timeline.months.length, 12);
  assert.equal(result.timeline.months[0].id, "2025-11");
  assert.equal(result.timeline.months.at(-1)!.id, "2026-10");
  assert.deepEqual(ids(result.timeline.months, "2026-03"), ["release"]);
  assert.deepEqual(ids(result.timeline.months, "2026-10"), ["push"]);
  assert.deepEqual(ids(result.timeline.months, "2025-11"), ["created"]);
  assert.deepEqual(result.timeline.older.recordIds, ["older"]);
  assert.deepEqual(result.timeline.future.recordIds, ["future"]);
  assert.deepEqual(result.timeline.missing.recordIds, ["missing", "invalid"]);
  assertPartition([...result.timeline.months, result.timeline.older, result.timeline.future, result.timeline.missing], result.recordIds);
});

test("timeline compares instants consistently across offsets and ignores invalid dates without losing valid activity", () => {
  assert.equal(signalDashboardDate(github("offset", { publishedAt: null,
    pushedAt: "2026-09-30T23:30:00-02:00", releasedAt: "2026-10-01T00:30:00+02:00" })), "2026-10-01T01:30:00.000Z");
  assert.equal(signalDashboardDate(news("missing", { publishedAt: null })), null);
  const result = buildSignalDashboard([
    github("offset", { publishedAt: null, pushedAt: "2026-09-30T23:30:00-02:00", releasedAt: "2026-10-01T00:30:00+02:00" }),
    github("one-valid", { publishedAt: null, pushedAt: "2026-05-01T00:00:00Z", releasedAt: "2026-02-30T00:00:00Z" }),
  ], "github", asOf);
  assert.deepEqual(ids(result.timeline.months, "2026-10"), ["offset"]);
  assert.deepEqual(ids(result.timeline.months, "2026-05"), ["one-valid"]);
  const leap = buildSignalDashboard([news("leap", { publishedAt: "2024-02-29T00:00:00Z" })], "news", "2024-03-01T00:00:00Z");
  assert.deepEqual(ids(leap.timeline.months, "2024-02"), ["leap"]);
});

test("invalid reference dates fail closed without using the local clock", () => {
  const records = [github("repo", { pushedAt: asOf, releasedAt: asOf, releaseUrl: "https://github.com/lab/repo/releases/tag/v1", license: "MIT" })];
  for (const invalid of ["", "tomorrow", "2026-02-30T00:00:00Z"]) {
    const result = buildSignalDashboard(records, "github", invalid);
    assert.equal(result.referenceDateValid, false);
    assert.equal(result.total, 1);
    assert.deepEqual(result.timeline.months, []);
    assert.deepEqual(result.timeline.missing.recordIds, ["repo"]);
    assert.deepEqual(ids(result.metrics, "recent90"), []);
    assert.deepEqual(ids(result.metrics, "released"), []);
    assert.deepEqual(ids(result.metrics, "licensed"), ["repo"]);
    assert.deepEqual(ids(result.maintenance, "unknown"), ["repo"]);
  }
});

test("license and release metrics require identifiable public metadata and never assume missing means absent", () => {
  const records = [
    github("valid", { license: " MIT ", releasedAt: asOf, releaseUrl: "https://github.com/lab/valid/releases/tag/v1" }),
    github("noassertion", { license: " noassertion ", releasedAt: asOf }),
    github("none", { license: "NONE", releaseUrl: "https://github.com/lab/none/releases/tag/v1" }),
    github("blank", { license: "  ", releasedAt: asOf, releaseUrl: "http://github.com/lab/blank/releases/tag/v1" }),
    github("future", { license: "Apache-2.0", releasedAt: "2030-01-01T00:00:00Z", releaseUrl: "https://github.com/lab/future/releases/tag/v1" }),
    github("invalid", { releasedAt: "2026-02-30T00:00:00Z", releaseUrl: "https://github.com/lab/invalid/releases/tag/v1" }),
  ];
  const result = buildSignalDashboard(records, "github", asOf);
  assert.deepEqual(ids(result.metrics, "licensed"), ["future", "valid"]);
  assert.deepEqual(ids(result.metrics, "released"), ["valid"]);
});

test("categories retain overlap across directions, deduplicate related routes, and include every unknown record", () => {
  const result = buildSignalDashboard([
    github("cross", { discoveryGroups: ["segmentation", "detection", "segmentation", "ct"] }),
    github("unknown", { discoveryGroups: ["future-route"] }), github("empty"),
  ], "github", asOf);
  assert.equal(result.categories.length, 13);
  assert.deepEqual(ids(result.categories, "diagnostic-tasks"), ["cross"]);
  assert.deepEqual(ids(result.categories, "radiology-nuclear"), ["cross"]);
  assert.deepEqual(ids(result.categories, "general-resources"), ["empty", "unknown"]);
  assert.equal(result.categories.reduce((sum, row) => sum + row.count, 0), 4);
  assert.equal(new Set(result.categories.flatMap(row => row.recordIds)).size, result.total);
});

test("language top six, other and unknown are an exhaustive, deterministic partition", () => {
  const records = [
    ...Array.from({ length: 9 }, (_, index) => github(`lang-${index}`, { language: `Language ${index}` })),
    github("case-duplicate", { language: " language 8 " }),
    github("no-language"), github("blank-language", { language: "  " }),
  ];
  const result = buildSignalDashboard(records, "github", asOf);
  assert.equal(result.languages.length, 8);
  assert.equal(result.languages[0].count, 2);
  assert.equal(result.languages[0].labelEn, "Language 8");
  assert.equal(result.languages.at(-2)!.count, 3);
  assert.equal(result.languages.at(-1)!.count, 2);
  assertPartition(result.languages, result.recordIds);
});

test("maintenance is exclusive with archived taking priority; missing and future pushes stay unverified", () => {
  const result = buildSignalDashboard([
    github("archived", { archived: true, pushedAt: asOf }), github("recent", { pushedAt: asOf }),
    github("older", { pushedAt: "2020-01-01T00:00:00Z" }), github("missing"),
    github("future", { pushedAt: "2030-01-01T00:00:00Z" }),
  ], "github", asOf);
  assert.deepEqual(ids(result.maintenance, "archived"), ["archived"]);
  assert.deepEqual(ids(result.maintenance, "recent90"), ["recent"]);
  assert.deepEqual(ids(result.maintenance, "older"), ["older"]);
  assert.deepEqual(ids(result.maintenance, "unknown"), ["future", "missing"]);
  assert.deepEqual(ids(result.metrics, "recent90"), ["archived", "recent"]);
  assertPartition(result.maintenance, result.recordIds);
});

test("news publisher names, types and original links use the same population without treating records as events", () => {
  const records = [
    news("model", { publisher: " Lab A ", newsType: "model", originalUrl: "https://example.com/model" }),
    news("research", { publisher: "lab a", newsType: "research", publishedAt: null }),
    news("tool", { publisher: "Lab B", newsType: "tooling", originalUrl: "javascript:alert(1)" }),
    news("unknown", { publisher: "Unknown" }), news("blank", { publisher: "  " }),
  ];
  const result = buildSignalDashboard(records, "news", asOf);
  assert.equal(result.metrics.find(row => row.id === "publishers")!.count, 2);
  assert.deepEqual(ids(result.metrics, "publishers"), ["model", "research", "tool"]);
  assert.deepEqual(ids(result.metrics, "original"), ["model"]);
  assert.deepEqual(ids(result.newsTypes, "model"), ["model"]);
  assert.deepEqual(ids(result.newsTypes, "tooling"), ["tool"]);
  assertPartition(result.newsTypes, result.recordIds);
  assertPartition(result.publishers, result.recordIds);
  assert.deepEqual(result.timeline.missing.recordIds, ["research"]);
});

test("publisher top eight and other never drop rows or collide with a publisher named Other", () => {
  const records = [news("literal-other", { publisher: "Other" }),
    ...Array.from({ length: 11 }, (_, index) => news(`publisher-${index}`, { publisher: `Publisher ${index}` })),
    news("unknown", { publisher: "" })];
  const result = buildSignalDashboard(records, "news", asOf);
  assert.equal(result.publishers.length, 10);
  assert.equal(result.publishers.find(row => row.id === "publisher:other")!.count, 4);
  assert(result.publishers.some(row => row.id === "publisher:value:other"));
  assertPartition(result.publishers, result.recordIds);
});

test("empty scopes retain useful zero-valued categories and calendar bins", () => {
  for (const kind of ["github", "news"] as const) {
    const result = buildSignalDashboard([], kind, asOf);
    assert.equal(result.total, 0);
    assert.equal(result.metrics.length, 4);
    assert(result.metrics.every(row => row.count === 0));
    assert.equal(result.timeline.months.length, 12);
    assert(result.categories.every(row => row.count === 0));
  }
});

test("current archive chart partitions reconcile to the dynamic source populations", () => {
  const data = JSON.parse(readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8")) as { generatedAt: string; records: ResearchSignal[] };
  for (const kind of ["github", "news"] as const) {
    const result = buildSignalDashboard(data.records, kind, data.generatedAt);
    const expected = [...new Set(data.records.filter(record => record.kind === kind).map(record => record.id))];
    assert.equal(result.total, expected.length);
    assert.deepEqual([...new Set(result.categories.flatMap(row => row.recordIds))].sort(), [...expected].sort());
    assertPartition([...result.timeline.months, result.timeline.missing, result.timeline.future, result.timeline.older], expected);
    for (const rows of kind === "github" ? [result.languages, result.maintenance] : [result.newsTypes, result.publishers]) assertPartition(rows, expected);
    for (const metric of result.metrics) assert(metric.recordIds.every(id => expected.includes(id)));
  }
});

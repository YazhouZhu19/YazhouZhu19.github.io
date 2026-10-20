import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterNews,
  normalizeNewsTitle,
  newsTitleShingles,
  newsTitleSimilarity,
  NEWS_CLUSTER_VERSION,
} from "../lib/news-cluster";
import type { NewsSignal } from "../lib/research-signals";
import { buildSignalOverviews, createSignalsSnapshot } from "../scripts/signals-snapshot";
import { parseSignalsManifest } from "../lib/signals-snapshot";
import { emptyResearchSignalsData } from "../lib/research-signals";
const now = "2026-10-21T00:00:00Z";
const news = (
  id: string,
  title = "New AI model improves medical imaging diagnosis",
  publishedAt: string | null = "2026-10-20T00:00:00Z",
  publisher = "Example",
): NewsSignal => ({
  id,
  kind: "news",
  title,
  publisher,
  publishedAt,
  url: `https://example.org/${id}`,
  summary: "Full source metadata retained",
  summaryKind: "publisher-excerpt",
  firstSeenAt: now,
  observedAt: now,
  updatedAt: null,
  topics: [],
  sourceId: "news-example",
  relatedUrls: [],
  newsType: "model",
  discoveryUrl: null,
  originalUrl: `https://example.org/${id}`,
});
test("normalization handles publisher suffixes, punctuation and multilingual text without stripping content", () => {
  assert.equal(normalizeNewsTitle("  AI Model: MRI! - Reuters", "Reuters"), "ai model mri");
  assert.equal(
    normalizeNewsTitle("AI imaging model - early clinical evaluation", "Example"),
    "ai imaging model early clinical evaluation",
  );
  assert.equal(normalizeNewsTitle("ＭＲＩ：医学影像 - 医学新闻", "医学新闻"), "mri 医学影像");
});
test("similar formulations group and retain every original record", () => {
  const records = [
    news("a", "New AI model improves medical imaging diagnosis - Reuters", undefined, "Reuters"),
    news("b", "New AI model improves medical imaging diagnostics", undefined, "Nature"),
  ];
  const events = clusterNews(records);
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceCount, 2);
  assert.equal(events[0].representative, records[0]);
  assert.deepEqual(events[0].members, records);
  assert.equal(events[0].firstPublishedAt, records[0].publishedAt);
  assert.equal(clusterNews([records[0], news("c", "Hospital acquires robotic surgery equipment")]).length, 2);
});
test("publication window is inclusive and unknown or impossible dates stay separate", () => {
  const a = news("a", undefined, "2026-10-01T00:00:00Z");
  assert.equal(clusterNews([a, news("b", undefined, "2026-10-08T00:00:00Z")]).length, 1);
  assert.equal(clusterNews([a, news("b", undefined, "2026-10-08T00:00:00.001Z")]).length, 2);
  for (const date of [null, "bad", "2026-02-30T00:00:00Z"])
    assert.equal(clusterNews([news("a", undefined, date), news("b", undefined, date)]).length, 2);
  assert.equal(clusterNews([news("a", "AI news"), news("b", "AI news")]).length, 2);
});
test("deterministic complete-link grouping prevents transitive title/date bridges", () => {
  const a = news("a", undefined, "2026-10-01T00:00:00Z"),
    b = news("b", undefined, "2026-10-07T00:00:00Z"),
    c = news("c", undefined, "2026-10-12T00:00:00Z");
  assert.deepEqual(clusterNews([c, b, a]), clusterNews([a, b, c]));
  assert.deepEqual(
    clusterNews([a, b, c]).map((e) => e.members.map((r) => r.id)),
    [["a", "b"], ["c"]],
  );
  const grams = (s: string) => newsTitleShingles(normalizeNewsTitle(s));
  const titles = [
    "medical imaging brain diagnosis therapy",
    "medical imaging brain diagnosis therapy cancer screening",
    "medical imaging diagnosis therapy cancer screening",
  ];
  assert.ok(newsTitleSimilarity(grams(titles[0]), grams(titles[1])) >= 0.6);
  assert.ok(newsTitleSimilarity(grams(titles[1]), grams(titles[2])) >= 0.6);
  assert.ok(newsTitleSimilarity(grams(titles[0]), grams(titles[2])) < 0.6);
  assert.equal(clusterNews(titles.map((title, i) => news(String(i), title))).length, 2);
  assert.throws(() => clusterNews([a, a]), /Duplicate news ID/);
});
test("event overview is optional for old manifests and bounded by scoped records", () => {
  const data = {
    ...emptyResearchSignalsData(),
    generatedAt: now,
    sources: [
      {
        id: "news-example",
        kind: "news" as const,
        name: "Example",
        url: "https://example.org/",
        status: "ok" as const,
        checkedAt: now,
        lastSuccessAt: now,
        received: 2,
        retained: 2,
        error: null,
        coverage: "Public news",
      },
    ],
    records: [news("a"), news("b")],
  };
  const overview = buildSignalOverviews(data);
  assert.equal(overview.news.events?.version, NEWS_CLUSTER_VERSION);
  assert.equal(overview.news.events?.count, 1);
  const snapshot = createSignalsSnapshot(data);
  const manifest = structuredClone(snapshot.manifest);
  assert.equal(parseSignalsManifest(manifest).overview.news.events?.count, 1);
  delete manifest.overview.news.events;
  assert.equal(parseSignalsManifest(manifest).overview.news.events, undefined);
  manifest.overview.news.events = { version: NEWS_CLUSTER_VERSION, count: 3 };
  assert.throws(() => parseSignalsManifest(manifest), /event/);
});

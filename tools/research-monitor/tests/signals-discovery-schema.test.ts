import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyResearchSignalsData, GitHubDiscoveryStateSchema, NewsDiscoveryStateSchema, NewsSignalSchema,
  parseResearchSignalsData, SignalRelevanceSchema, SIGNALS_MAX_BYTES, SIGNALS_MAX_RECORDS } from "../lib/research-signals";
import { fetchResearchSignals, ResearchSignalsLoadError } from "../lib/signals-loader";

const github = { catalogVersion: "test", cursor: 0, queue: [{ groupId: "segmentation", query: "medical imaging", sort: "best-match", page: 1, from: "2026-01-01", to: "2026-01-01" }], completedQueries: 0, repositoryCursor: 0, cycles: 0 };
const news = { catalogVersion: "test", cursor: 0, queue: [{ queryId: "medical-imaging-en", from: "2026-01-01", to: "2026-02-01" }], completedWindows: 0 };

test("discovery checkpoints retain independent providers and accept old snapshots without checkpoints", () => {
  const snapshot = emptyResearchSignalsData("2026-10-15T00:00:00Z");
  assert.equal(parseResearchSignalsData(snapshot).discoveryState, undefined);
  const parsed = parseResearchSignalsData({ ...snapshot, discoveryState: { github, news } });
  assert.deepEqual(parsed.discoveryState, { github, news });
  assert.throws(() => parseResearchSignalsData({ ...snapshot, discoveryState: { thirdParty: {} } }));
  assert.equal(SIGNALS_MAX_RECORDS, 50000);
  assert.equal(SIGNALS_MAX_BYTES, 64 * 1024 * 1024);
});

test("checkpoint schemas bound queues, pages and real calendar dates", () => {
  for (const change of [{ page: 0 }, { page: 11 }, { from: "2026-02-30" }, { to: "2025-12-31" }, { sort: "stars" }, { secret: "ignored" }]) {
    assert.equal(GitHubDiscoveryStateSchema.safeParse({ ...github, queue: [{ ...github.queue[0], ...change }] }).success, false);
  }
  assert.equal(GitHubDiscoveryStateSchema.safeParse({ ...github, queue: Array(2001).fill(github.queue[0]) }).success, false);
  assert.equal(NewsDiscoveryStateSchema.safeParse({ ...news, queue: Array(6001).fill(news.queue[0]) }).success, false);
  assert.equal(NewsDiscoveryStateSchema.safeParse({ ...news, queue: [{ ...news.queue[0], to: "2026-01-01" }] }).success, false);
  assert.equal(NewsDiscoveryStateSchema.safeParse({ ...news, queue: [{ ...news.queue[0], from: "2026-13-01" }] }).success, false);
  assert.equal(GitHubDiscoveryStateSchema.safeParse({ ...github, cursor: Infinity }).success, false);
});

test("relevance is explained and bounded, and discovery labels are available to news", () => {
  assert.deepEqual(SignalRelevanceSchema.parse({ level: "candidate", reasons: ["imaging-context"] }), { level: "candidate", reasons: ["imaging-context"] });
  for (const value of [{ level: "direct", reasons: [] }, { level: "direct", reasons: ["x", "x"] }, { level: "verified", reasons: ["x"] }, { level: "direct", reasons: ["x"], quality: 100 }]) {
    assert.equal(SignalRelevanceSchema.safeParse(value).success, false);
  }
  const article = {
    id: "news:example", title: "Imaging model release", url: "https://example.org/news/model", summary: "A public search snippet",
    summaryKind: "search-snippet", publisher: "Example", publishedAt: null, firstSeenAt: "2026-10-15T00:00:00Z", observedAt: "2026-10-15T00:00:00Z",
    updatedAt: null, topics: [], sourceId: "google-news", relatedUrls: [], kind: "news", newsType: "model", discoveryUrl: null, originalUrl: null,
    discoveryGroups: ["foundation-models"], relevance: { level: "direct", reasons: ["medical-imaging"] },
  };
  assert.deepEqual(NewsSignalSchema.parse(article).discoveryGroups, ["foundation-models"]);
  assert.equal(NewsSignalSchema.safeParse({ ...article, discoveryGroups: ["foundation-models", "foundation-models"] }).success, false);
});

test("the reader stops an oversized streamed snapshot instead of buffering the entire response", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const fetcher = (async () => new Response(stream)) as typeof fetch;
  await assert.rejects(fetchResearchSignals(new AbortController().signal, "/", fetcher), error => error instanceof ResearchSignalsLoadError && error.kind === "format");
  assert.equal(cancelled, true);
  assert(reads <= SIGNALS_MAX_BYTES / (1024 * 1024) + 2);
});

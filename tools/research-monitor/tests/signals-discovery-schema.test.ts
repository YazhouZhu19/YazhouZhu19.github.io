import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyResearchSignalsData,
  GitHubDiscoveryStateSchema,
  NewsDiscoveryStateSchema,
  NewsSignalSchema,
  parseResearchSignalsData,
  ResearchSignalsDataSchema,
  SignalRelevanceSchema,
  SignalSourceStateSchema,
  SIGNALS_MAX_BYTES,
  SIGNALS_MAX_RECORDS,
  SIGNALS_MAX_SOURCES,
} from "../lib/research-signals";
import { fetchResearchSignals, ResearchSignalsLoadError } from "../lib/signals-loader";

const github = {
  catalogVersion: "test",
  cursor: 0,
  queue: [
    {
      groupId: "segmentation",
      query: "medical imaging",
      sort: "best-match",
      page: 1,
      from: "2026-01-01",
      to: "2026-01-01",
    },
  ],
  completedQueries: 0,
  repositoryCursor: 0,
  cycles: 0,
};
const news = {
  catalogVersion: "test",
  cursor: 0,
  queue: [{ queryId: "medical-imaging-en", from: "2026-01-01", to: "2026-02-01" }],
  completedWindows: 0,
};

test("discovery checkpoints retain independent providers and accept old snapshots without checkpoints", () => {
  const snapshot = emptyResearchSignalsData("2026-10-15T00:00:00Z");
  assert.equal(parseResearchSignalsData(snapshot).discoveryState, undefined);
  const parsed = parseResearchSignalsData({ ...snapshot, discoveryState: { github, news } });
  assert.deepEqual(parsed.discoveryState, { github, news });
  assert.throws(() => parseResearchSignalsData({ ...snapshot, discoveryState: { thirdParty: {} } }));
  assert.equal(SIGNALS_MAX_RECORDS, 100000);
  assert.equal(SIGNALS_MAX_BYTES, 96 * 1024 * 1024);
});

function repositorySnapshot(size: number) {
  const timestamp = "2026-10-20T00:00:00Z";
  return {
    ...emptyResearchSignalsData(timestamp),
    sources: [
      {
        id: "github-public",
        name: "GitHub public repositories",
        kind: "github",
        url: "https://api.github.com",
        status: "ok",
        checkedAt: timestamp,
        lastSuccessAt: timestamp,
        received: size,
        retained: size,
        error: null,
        coverage: "Repository metadata",
      },
    ],
    records: Array.from({ length: size }, (_, index) => ({
      id: `github:lab/repository-${index}`,
      kind: "github",
      title: `lab/repository-${index}`,
      fullName: `lab/repository-${index}`,
      url: `https://github.com/lab/repository-${index}`,
      summary: "",
      summaryKind: "repository-description",
      publisher: "lab",
      publishedAt: timestamp,
      firstSeenAt: timestamp,
      observedAt: timestamp,
      updatedAt: timestamp,
      topics: [],
      sourceId: "github-public",
      relatedUrls: [],
      stars: index,
      forks: 0,
      openIssues: 0,
      license: null,
      language: null,
      archived: false,
      pushedAt: timestamp,
      releasedAt: null,
      releaseUrl: null,
      readmeExcerpt: "",
    })),
  };
}

test("growing archives preserve valid unique repositories beyond the former 50000-record limit", () => {
  const parsed = parseResearchSignalsData(repositorySnapshot(50001));
  assert.equal(parsed.records.length, 50001);
  assert.equal(parsed.records[0].id, "github:lab/repository-0");
  assert.equal(parsed.records.at(-1)?.id, "github:lab/repository-50000");
});

test("archives exceeding the new record limit are rejected without truncating records", () => {
  const result = ResearchSignalsDataSchema.safeParse(repositorySnapshot(SIGNALS_MAX_RECORDS + 1));
  assert.equal(result.success, false);
  if (result.success) assert.fail("An oversized record array must be rejected");
  assert.equal(result.error.issues.length, 1);
  const issue = result.error.issues[0];
  assert.equal(issue.code, "too_big");
  assert.deepEqual(issue.path, ["records"]);
  if (issue.code === "too_big") {
    assert.equal(issue.maximum, SIGNALS_MAX_RECORDS);
    assert.equal(issue.type, "array");
  }
});

test("checkpoint schemas bound queues, pages and real calendar dates", () => {
  for (const change of [
    { page: 0 },
    { page: 11 },
    { from: "2026-02-30" },
    { to: "2025-12-31" },
    { sort: "stars" },
    { secret: "ignored" },
  ]) {
    assert.equal(
      GitHubDiscoveryStateSchema.safeParse({ ...github, queue: [{ ...github.queue[0], ...change }] }).success,
      false,
    );
  }
  assert.equal(
    GitHubDiscoveryStateSchema.safeParse({ ...github, queue: Array(2001).fill(github.queue[0]) }).success,
    false,
  );
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({ ...news, queue: Array(6001).fill(news.queue[0]) }).success,
    false,
  );
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({ ...news, queue: [{ ...news.queue[0], to: "2026-01-01" }] }).success,
    false,
  );
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({ ...news, queue: [{ ...news.queue[0], from: "2026-13-01" }] })
      .success,
    false,
  );
  assert.equal(GitHubDiscoveryStateSchema.safeParse({ ...github, cursor: Infinity }).success, false);
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({ ...news, recentCheckedAt: { route: "2026-10-15T00:00:00Z" } })
      .success,
    true,
  );
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({ ...news, recentCheckedAt: { route: "invalid" } }).success,
    false,
  );
  assert.equal(
    NewsDiscoveryStateSchema.safeParse({
      ...news,
      recentCheckedAt: Object.fromEntries(
        Array.from({ length: 161 }, (_, index) => [`route-${index}`, "2026-10-15T00:00:00Z"]),
      ),
    }).success,
    false,
  );
});

test("expanded source catalogs are bounded and never label unattempted queries as checked", () => {
  const pending = {
    id: "news-new",
    name: "New discovery route",
    kind: "news",
    url: "https://news.google.com/rss/search?q=imaging",
    status: "pending",
    checkedAt: null,
    lastSuccessAt: null,
    received: 0,
    retained: 0,
    error: null,
    coverage: "Queued for a first check",
  };
  assert.equal(SignalSourceStateSchema.safeParse(pending).success, true);
  for (const change of [
    { checkedAt: "2026-10-15T00:00:00Z" },
    { lastSuccessAt: "2026-10-15T00:00:00Z" },
    { received: 1 },
    { error: "Not attempted" },
    { status: "ok" },
    { status: "partial" },
    { status: "error" },
  ])
    assert.equal(SignalSourceStateSchema.safeParse({ ...pending, ...change }).success, false);
  const legacy = {
    ...pending,
    status: "ok",
    checkedAt: "2026-10-15T00:00:00Z",
    lastSuccessAt: "2026-10-15T00:00:00Z",
  };
  assert.equal(SignalSourceStateSchema.safeParse(legacy).success, true);
  const snapshot = emptyResearchSignalsData("2026-10-15T00:00:00Z");
  const sources = Array.from({ length: SIGNALS_MAX_SOURCES }, (_, index) => ({
    ...pending,
    id: `news-${index}`,
  }));
  assert.equal(SIGNALS_MAX_SOURCES, 160);
  assert.equal(parseResearchSignalsData({ ...snapshot, sources }).sources.length, 160);
  assert.throws(() =>
    parseResearchSignalsData({ ...snapshot, sources: [...sources, { ...pending, id: "overflow" }] }),
  );
});

test("relevance is explained and bounded, and discovery labels are available to news", () => {
  assert.deepEqual(SignalRelevanceSchema.parse({ level: "candidate", reasons: ["imaging-context"] }), {
    level: "candidate",
    reasons: ["imaging-context"],
  });
  for (const value of [
    { level: "direct", reasons: [] },
    { level: "direct", reasons: ["x", "x"] },
    { level: "verified", reasons: ["x"] },
    { level: "direct", reasons: ["x"], quality: 100 },
  ]) {
    assert.equal(SignalRelevanceSchema.safeParse(value).success, false);
  }
  const article = {
    id: "news:example",
    title: "Imaging model release",
    url: "https://example.org/news/model",
    summary: "A public search snippet",
    summaryKind: "search-snippet",
    publisher: "Example",
    publishedAt: null,
    firstSeenAt: "2026-10-15T00:00:00Z",
    observedAt: "2026-10-15T00:00:00Z",
    updatedAt: null,
    topics: [],
    sourceId: "google-news",
    relatedUrls: [],
    kind: "news",
    newsType: "model",
    discoveryUrl: null,
    originalUrl: null,
    discoveryGroups: ["foundation-models"],
    relevance: { level: "direct", reasons: ["medical-imaging"] },
  };
  assert.deepEqual(NewsSignalSchema.parse(article).discoveryGroups, ["foundation-models"]);
  assert.equal(
    NewsSignalSchema.safeParse({ ...article, discoveryGroups: ["foundation-models", "foundation-models"] })
      .success,
    false,
  );
});

test("the reader stops an oversized streamed snapshot instead of buffering the entire response", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = (async () => new Response(stream)) as typeof fetch;
  await assert.rejects(
    fetchResearchSignals(new AbortController().signal, "/", fetcher),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
  assert.equal(cancelled, true);
  assert(reads <= SIGNALS_MAX_BYTES / (1024 * 1024) + 2);
});

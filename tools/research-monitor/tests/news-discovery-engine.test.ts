import test from "node:test";
import assert from "node:assert/strict";
import { collectNewsWindows, newsBackfillPlan, newsWindowUrl, NEWS_REQUEST_BUDGET, NEWS_BACKFILL_BUDGET } from "../lib/collect-news-signals";
import { NEWS_QUERIES } from "../lib/news-discovery";
import { emptyResearchSignalsData, type NewsSignal } from "../lib/research-signals";

const now = "2026-10-15T03:00:00.000Z";
const row = (sourceId: string, url: string): NewsSignal => ({ id: "news:shared", kind: "news", title: "Medical imaging AI model released", summary: "Open source medical imaging segmentation model", summaryKind: "search-snippet", publisher: "Research institution", url: "https://news.google.com/rss/articles/test", publishedAt: "2026-10-14T00:00:00.000Z", firstSeenAt: now, observedAt: now, updatedAt: null, topics: [], relatedUrls: [], sourceId, newsType: "model", discoveryUrl: url, originalUrl: null });

test("Google discovery rotates dimensions across bounded date windows", () => {
  const plan = newsBackfillPlan(now, 365);
  assert.deepEqual(plan.slice(0, NEWS_QUERIES.length).map(item => item.queryId), NEWS_QUERIES.map(query => query.id));
  assert(plan.length > NEWS_QUERIES.length * 10);
  for (const window of plan) {
    const span = Date.parse(window.to) - Date.parse(window.from);
    assert(span > 0 && span <= 30 * 86400000);
  }
  const url = new URL(newsWindowUrl(NEWS_QUERIES[0], plan[0]));
  assert.equal(url.hostname, "news.google.com");
  assert.match(url.searchParams.get("q")!, /after:\d{4}-\d{2}-\d{2} before:\d{4}-\d{2}-\d{2}/);
  assert.throws(() => newsBackfillPlan(now, 731));
});

test("news windows retain progress, union discovery groups and enforce reported dates", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => { calls.push(url); return { body: "rss", status: 200 }; };
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, fetcher,
    (_body, source, url) => ({ received: 2, records: [row(source, url), { ...row(source, url), id: "news:out-of-window", publishedAt: "2024-01-01T00:00:00Z" }] }));
  assert.equal(calls.length, NEWS_REQUEST_BUDGET);
  assert.equal(result.records.length, 1);
  assert(result.records[0].discoveryGroups!.length > 1);
  assert.equal(result.records[0].relevance?.level, "direct");
  assert(result.state.queue.length > 0);
  const before = result.state.queue[0];
  const previous = { ...emptyResearchSignalsData(now), sources: result.sources, records: result.records, discoveryState: { news: result.state } };
  const next = await collectNewsWindows(previous, "2026-10-15T12:00:00.000Z", 365, fetcher, () => ({ received: 0, records: [] }));
  assert(next.state.cursor > result.state.cursor);
  assert(!next.state.queue.some(window => JSON.stringify(window) === JSON.stringify(before)), "historical queue progresses despite fresh-window refresh");
});

test("dense Google windows split and failed windows remain queued instead of disappearing", async () => {
  let calls = 0;
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => {
    calls++; if (calls === 2) throw new Error("private response must not leak"); return { body: String(calls), status: 200 };
  }, body => ({ received: body === "1" ? 100 : 0, records: [] }));
  const original = newsBackfillPlan(now, 365)[0];
  const split = result.state.queue.filter(window => window.queryId === original.queryId && window.from >= original.from && window.to <= original.to);
  assert.equal(split.length, 2);
  assert.equal(split[0].to, split[1].from);
  assert(result.state.queue.some(window => window.queryId === NEWS_QUERIES[1].id && window.from === original.from));
  assert(!JSON.stringify(result).includes("private response"));
  assert(result.sources.some(source => source.status === "partial" || source.status === "error"));
});

test("the refresh cache skips exhausted work but does not hide unfinished history", async () => {
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 30, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const previous = { ...emptyResearchSignalsData(now), sources: result.sources, discoveryState: { news: result.state } };
  let calls = 0;
  const continued = await collectNewsWindows(previous, now, 30, async () => { calls++; return { body: "rss", status: 200 }; }, () => ({ received: 0, records: [] }));
  assert(calls > 0, "unfinished windows continue even at the same timestamp");
  assert(continued.state.queue.length < result.state.queue.length);
  const complete = { ...previous, sources: continued.sources.map(source => ({ ...source, checkedAt: now })),
    discoveryState: { news: { ...continued.state, queue: [], recentCheckedAt: Object.fromEntries(NEWS_QUERIES.map(query => [query.id, now])) } } };
  calls = 0;
  const cached = await collectNewsWindows(complete, now, 30, async () => { calls++; throw new Error("unexpected"); }, () => ({ received: 0, records: [] }));
  assert.equal(calls, 0); assert.deepEqual(cached.state, complete.discoveryState.news);
  assert.deepEqual(cached.attemptStats, { requests: 0, successes: 0 });
});

test("a catalogue larger than the budget fairly reaches every recent query and advances history", async () => {
  const originalLength = NEWS_QUERIES.length;
  while (NEWS_QUERIES.length < NEWS_REQUEST_BUDGET * 3) {
    const index = NEWS_QUERIES.length;
    NEWS_QUERIES.push({ ...NEWS_QUERIES[0], id: `google-news-scaling-${index}`, query: `medical imaging scaling${index}` });
  }
  try {
    const recent = newsBackfillPlan(now, 29), recentKeys = new Set(recent.map(item => `${item.queryId}:${item.from}:${item.to}`));
    const seenRecent = new Set<string>();
    let historicalRequests = 0;
    let previous = emptyResearchSignalsData(now);
    const rounds = Math.ceil(NEWS_QUERIES.length / (NEWS_REQUEST_BUDGET * 2 / 3)) + 1;
    for (let round = 0; round < rounds; round++) {
      const result = await collectNewsWindows(previous, now, 365, async () => ({ body: "rss", status: 200 }), (_body, source, url) => {
        const query = new URL(url).searchParams.get("q")!;
        const [, from, to] = query.match(/after:(\S+) before:(\S+)/)!;
        if (recentKeys.has(`${source}:${from}:${to}`)) seenRecent.add(source); else historicalRequests++;
        return { received: 0, records: [] };
      });
      assert(result.attemptStats.requests <= NEWS_REQUEST_BUDGET);
      if (!round) {
        const pending = result.sources.filter(source => source.status === "pending");
        assert(pending.length > 0, "unattempted sources remain visibly pending");
        assert(pending.every(source => source.checkedAt === null && source.lastSuccessAt === null && /尚未请求/.test(source.coverage)));
      }
      previous = { ...previous, sources: result.sources, discoveryState: { news: result.state } };
    }
    assert.equal(seenRecent.size, NEWS_QUERIES.length, "later catalogue entries are not starved");
    assert(historicalRequests >= rounds * NEWS_REQUEST_BUDGET / 3, "history gets capacity while recent work is outstanding");
  } finally { NEWS_QUERIES.splice(originalLength); }
});

test("repeated failures rotate through all queries and HTTP errors are never counted as success", async () => {
  const originalLength = NEWS_QUERIES.length;
  while (NEWS_QUERIES.length < NEWS_REQUEST_BUDGET * 2) {
    const index = NEWS_QUERIES.length;
    NEWS_QUERIES.push({ ...NEWS_QUERIES[0], id: `google-news-failure-${index}`, query: `medical imaging failure${index}` });
  }
  try {
    let previous = emptyResearchSignalsData(now), parsed = 0;
    const attempted = new Set<string>();
    const queries = new Map(NEWS_QUERIES.map(query => [query.query, query.id]));
    for (let round = 0; round < Math.ceil(NEWS_QUERIES.length / NEWS_REQUEST_BUDGET) + 1; round++) {
      const result = await collectNewsWindows(previous, now, 7, async url => {
        const query = new URL(url).searchParams.get("q")!.replace(/ after:.*$/, "");
        attempted.add(queries.get(query)!);
        return { body: "rate limited", status: 429 };
      }, () => { parsed++; return { received: 0, records: [] }; });
      assert.equal(result.attemptStats.successes, 0);
      assert.equal(result.state.completedWindows, 0);
      assert.equal(result.state.queue.length, NEWS_QUERIES.length);
      assert(result.sources.every(source => source.lastSuccessAt === null));
      previous = { ...previous, sources: result.sources, discoveryState: { news: result.state } };
    }
    assert.equal(attempted.size, NEWS_QUERIES.length);
    assert.equal(parsed, 0);
  } finally { NEWS_QUERIES.splice(originalLength); }
});

test("backfill mode keeps the deep budget and reports actual partial successes", async () => {
  let calls = 0;
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => {
    calls++; if (calls === 1) throw new Error("private detail");
    return { body: "rss", status: 200 };
  }, () => ({ received: 0, records: [] }), { discoveryMode: "backfill" });
  assert.equal(result.attemptStats.requests, NEWS_BACKFILL_BUDGET);
  assert.equal(result.attemptStats.successes, NEWS_BACKFILL_BUDGET - 1);
  const failedThenSucceeded = result.sources.find(source => source.id === NEWS_QUERIES[0].id)!;
  assert.equal(failedThenSucceeded.status, "partial");
  assert.equal(failedThenSucceeded.lastSuccessAt, now, "a later successful window is a real observation despite an earlier failure");
  assert(result.state.queue.some(window => window.queryId === NEWS_QUERIES[0].id));
});

test("historical checks cannot extend a recent-window cache", async () => {
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const later = "2026-10-15T10:00:00.000Z";
  const previous = { ...emptyResearchSignalsData(later), sources: result.sources.map(source => ({ ...source, checkedAt: later, lastSuccessAt: later })),
    discoveryState: { news: { ...result.state, recentCheckedAt: Object.fromEntries(NEWS_QUERIES.map(query => [query.id, now])) } } };
  const recent = new Set(newsBackfillPlan(later, 29).map(item => `${item.from}:${item.to}`));
  let recentRequests = 0;
  const next = await collectNewsWindows(previous, later, 365, async url => {
    const [, from, to] = new URL(url).searchParams.get("q")!.match(/after:(\S+) before:(\S+)/)!;
    if (recent.has(`${from}:${to}`)) recentRequests++;
    return { body: "rss", status: 200 };
  }, () => ({ received: 0, records: [] }));
  assert(recentRequests > 0, "recent windows refresh even if historical source checks just succeeded");
  assert(Object.values(next.state.recentCheckedAt!).includes(later));
});

test("future recent-check timestamps receive a real check instead of starving behind expired queries", async () => {
  const originalLength = NEWS_QUERIES.length;
  while (NEWS_QUERIES.length <= NEWS_REQUEST_BUDGET) {
    const index = NEWS_QUERIES.length;
    NEWS_QUERIES.push({ ...NEWS_QUERIES[0], id: `google-news-clock-${index}`, query: `medical imaging clock${index}` });
  }
  try {
    const seed = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
    const target = NEWS_QUERIES.at(-1)!.id, later = "2026-10-15T10:00:00.000Z";
    const recentCheckedAt = Object.fromEntries(NEWS_QUERIES.map(query => [query.id, query.id === target ? "2027-01-01T00:00:00.000Z" : now]));
    const previous = { ...emptyResearchSignalsData(now), sources: seed.sources, discoveryState: { news: { ...seed.state, queue: [], recentCheckedAt } } };
    const attempted = new Set<string>();
    const result = await collectNewsWindows(previous, later, 365, async () => ({ body: "rss", status: 200 }), (_body, source) => {
      attempted.add(source); return { received: 0, records: [] };
    });
    assert.equal(result.attemptStats.requests, NEWS_REQUEST_BUDGET);
    assert(attempted.has(target), "future timestamp cannot push a due query permanently behind the finite budget");
    assert.equal(result.state.recentCheckedAt![target], later);
  } finally { NEWS_QUERIES.splice(originalLength); }
});

test("oversized split queues fail without mutating the old snapshot", async () => {
  const seed = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const queue = Array.from({ length: 6000 }, (_, index) => {
    const start = Date.parse("2026-01-01T00:00:00Z") + Math.floor(index / NEWS_QUERIES.length) * 86400000;
    return { queryId: NEWS_QUERIES[index % NEWS_QUERIES.length].id, from: new Date(start).toISOString().slice(0, 10), to: new Date(start + 2 * 86400000).toISOString().slice(0, 10) };
  });
  const previous = { ...emptyResearchSignalsData(now), sources: seed.sources,
    discoveryState: { news: { ...seed.state, queue, recentCheckedAt: Object.fromEntries(NEWS_QUERIES.map(query => [query.id, now])) } } };
  const before = JSON.stringify(previous);
  await assert.rejects(collectNewsWindows(previous, now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 100, records: [] })), /超过上限/);
  assert.equal(JSON.stringify(previous), before);
});

test("resuming after a long outage restores missing history even when the old queue was empty", async () => {
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const previous = { ...emptyResearchSignalsData(now), sources: result.sources, discoveryState: { news: { ...result.state, queue: [] } } };
  const resumed = await collectNewsWindows(previous, "2026-12-15T03:00:00.000Z", 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  assert(resumed.state.queue.some(window => window.from < "2026-11-16" && window.to > "2026-10-15"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { collectNewsWindows, newsBackfillPlan, newsWindowUrl, NEWS_REQUEST_BUDGET } from "../lib/collect-news-signals";
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

test("fresh news catalogue state avoids issuing duplicate requests until the cache expires", async () => {
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 30, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const previous = { ...emptyResearchSignalsData(now), sources: result.sources, discoveryState: { news: result.state } };
  let calls = 0;
  const cached = await collectNewsWindows(previous, now, 30, async () => { calls++; throw new Error("unexpected"); }, () => ({ received: 0, records: [] }));
  assert.equal(calls, 0); assert.deepEqual(cached.state, result.state);
});

test("resuming after a long outage restores missing history even when the old queue was empty", async () => {
  const result = await collectNewsWindows(emptyResearchSignalsData(now), now, 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  const previous = { ...emptyResearchSignalsData(now), sources: result.sources, discoveryState: { news: { ...result.state, queue: [] } } };
  const resumed = await collectNewsWindows(previous, "2026-12-15T03:00:00.000Z", 365, async () => ({ body: "rss", status: 200 }), () => ({ received: 0, records: [] }));
  assert(resumed.state.queue.some(window => window.from < "2026-11-16" && window.to > "2026-10-15"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPublisherNews, mergePublisherNews, parsePublisherFeed } from "../lib/collect-publisher-news";
import { emptyResearchSignalsData, type NewsSignal, type ResearchSignal } from "../lib/research-signals";
import { NEWS_FEED_SOURCES, type NewsFeedSource } from "../lib/news-sources";

const now = "2026-10-15T12:00:00.000Z";
const source: NewsFeedSource = {
  id: "rss-news-example",
  name: "Example newsroom",
  publisher: "Example Research",
  url: "https://example.org/feed.xml",
  homepage: "https://example.org/",
  articleHosts: ["example.org"],
  aliases: [],
  groupId: "medical-imaging",
};
const item = (
  title = "Medical imaging AI model released",
  path = "/news/model",
  date = "Thu, 15 Oct 2026 09:00:00 GMT",
) =>
  `<item><title>${title}</title><link>https://example.org${path}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Researchers validate a medical imaging model.</p><script>bad()</script>]]></description></item>`;
const rss = (items = item()) =>
  `<rss version="2.0"><channel><title>Example</title><link>https://example.org/</link>${items}</channel></rss>`;

test("independent feeds retain publisher excerpts, original links, dates and provenance", () => {
  const parsed = parsePublisherFeed(
    rss(item("Medical imaging AI model released", "/news/model?utm_source=rss#top")),
    source,
    now,
    365,
  );
  assert.equal(parsed.records.length, 1);
  const row = parsed.records[0];
  assert.equal(row.originalUrl, "https://example.org/news/model");
  assert.equal(row.discoveryUrl, source.url);
  assert.equal(row.sourceId, source.id);
  assert.equal(row.summaryKind, "publisher-excerpt");
  assert.equal(row.summary, "Researchers validate a medical imaging model.");
  assert.equal(row.publishedAt, "2026-10-15T09:00:00.000Z");
  assert.equal(row.relevance?.level, "direct");
  assert.deepEqual(row.discoveryGroups, ["medical-imaging"]);
});

test("feed dates and relevance reject future, old and unrelated stories without false additions", () => {
  const body = rss(
    item() +
      item("Medical imaging research", "/old", "Wed, 01 Jan 2020 01:00:00 GMT") +
      item("Medical imaging research", "/future", "Thu, 15 Oct 2026 13:00:00 GMT") +
      item("Football club wins", "/sport").replace(/<description>.*?<\/description>/s, ""),
  );
  assert.equal(parsePublisherFeed(body, source, now, 365).records.length, 1);
  const navigation = rss(
    item("New AI technique could make minimally invasive surgeries safer").replace(
      /<description>.*?<\/description>/s,
      "<description>This patient-specific method helps doctors use X-rays for surgical navigation.</description>",
    ),
  );
  assert.equal(parsePublisherFeed(navigation, source, now, 365).records.length, 1);
});

test("Atom separates publication from updates, chooses the article link and supports updated-only metadata", () => {
  const entry =
    '<entry><title>Medical imaging AI model</title><link rel="self" href="https://example.org/api/1" type="application/atom+xml"/><link rel="alternate" href="/news/1"/><published>2026-10-01T09:00:00Z</published><updated>2026-10-14T09:00:00Z</updated><summary type="html">&lt;b&gt;Research model&lt;/b&gt;</summary></entry>';
  const body = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title>${entry}</feed>`;
  const row = parsePublisherFeed(body, source, now, 365).records[0];
  assert.equal(row.publishedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(row.updatedAt, "2026-10-14T09:00:00.000Z");
  assert.equal(row.originalUrl, "https://example.org/news/1");
  assert.equal(
    parsePublisherFeed(body.replace(/<published>.*?<\/published>/, ""), source, now, 365).records[0]
      .publishedAt,
    null,
  );
});

test("invalid, unsafe, truncated and entity-expanding feeds fail visibly while mixed metadata is partial", () => {
  const invalid = item().replace(/<link>.*?<\/link>/, "");
  const partial = parsePublisherFeed(rss(item() + invalid), source, now, 365);
  assert.equal(partial.invalid, 1);
  assert.equal(partial.records.length, 1);
  for (const body of [
    "<html>blocked</html>",
    rss().replace("</rss>", ""),
    rss().replace("</item>", ""),
    rss(invalid),
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + rss(),
    rss().replace("https://example.org/news", "https://evil.example/news"),
    rss().replace("https://example.org/news", "https://localhost/news"),
  ]) {
    assert.throws(() => parsePublisherFeed(body, source, now, 365));
  }
  assert.equal(parsePublisherFeed(rss(""), source, now, 365).records.length, 0);
  const cachedRss =
    rss(item("Medical imaging AI model", "/edt", "Thu, 15 Oct 2026 07:00:00 EDT")) +
    "<!-- cached by publisher -->";
  assert.equal(
    parsePublisherFeed(cachedRss, source, now, 365).records[0].publishedAt,
    "2026-10-15T11:00:00.000Z",
  );
});

test("direct collection caches successful reads and records real failures without replacing prior success", async () => {
  const initial = emptyResearchSignalsData(now);
  const success = await collectPublisherNews(initial, now, 365, async () => ({ status: 200, body: rss() }), {
    sources: [source],
  });
  assert.deepEqual(success.attemptStats, { requests: 1, successes: 1 });
  const previous = { ...initial, sources: success.sources, records: success.records };
  const cached = await collectPublisherNews(
    previous,
    now,
    365,
    async () => {
      throw new Error("must not request");
    },
    { sources: [source] },
  );
  assert.deepEqual(cached.attemptStats, { requests: 0, successes: 0 });
  const failure = await collectPublisherNews(
    previous,
    "2026-10-16T12:00:00Z",
    365,
    async () => ({ status: 429, body: rss() }),
    { sources: [source] },
  );
  assert.deepEqual(failure.attemptStats, { requests: 1, successes: 0 });
  assert.equal(failure.sources[0].status, "error");
  assert.equal(failure.sources[0].lastSuccessAt, now);
  assert.deepEqual(previous.records, success.records);
});

test("Google and publisher copies enrich an existing ID without resetting discovery or losing original metadata", () => {
  const direct = parsePublisherFeed(rss(), source, now, 365).records[0];
  const google: NewsSignal = {
    ...direct,
    id: "news:saved-google",
    sourceId: "google-news-imaging",
    publisher: "Example Research",
    title: direct.title.toUpperCase(),
    summaryKind: "search-snippet",
    summary: "Google snippet",
    originalUrl: null,
    url: "https://news.google.com/rss/articles/123",
    discoveryUrl: "https://news.google.com/rss/search?q=model",
    firstSeenAt: "2026-10-14T00:00:00Z",
  };
  const records = new Map<string, ResearchSignal>([[google.id, google]]);
  mergePublisherNews(records, direct);
  assert.equal(records.size, 1);
  let result = records.get(google.id) as NewsSignal;
  assert.equal(result.firstSeenAt, google.firstSeenAt);
  assert.equal(result.originalUrl, direct.originalUrl);
  assert.equal(result.discoveryUrl, google.discoveryUrl);
  assert.equal(result.summaryKind, "publisher-excerpt");
  mergePublisherNews(records, { ...google, observedAt: "2026-10-16T00:00:00Z" });
  result = records.get(google.id) as NewsSignal;
  assert.equal(result.summary, direct.summary);
  assert.equal(result.sourceId, source.id);
  assert.equal(result.originalUrl, direct.originalUrl);
  mergePublisherNews(records, { ...google, id: "news:other-publisher", publisher: "Other Publisher" });
  assert.equal(records.size, 2, "same title from a different publisher is a separate report");
});

test("publisher catalogue has bounded independent HTTPS feeds and explicit attribution", () => {
  assert(NEWS_FEED_SOURCES.length >= 4 && NEWS_FEED_SOURCES.length <= 30);
  assert.equal(new Set(NEWS_FEED_SOURCES.map((item) => item.id)).size, NEWS_FEED_SOURCES.length);
  for (const feed of NEWS_FEED_SOURCES) {
    assert.equal(new URL(feed.url).protocol, "https:");
    assert.notEqual(new URL(feed.url).hostname, "news.google.com");
    assert(feed.publisher && feed.homepage && feed.articleHosts.length);
    assert.match(feed.id, /^rss-news-[a-z-]+$/);
  }
});

test("reused publisher headlines do not merge distinct original articles", () => {
  const parsed = parsePublisherFeed(
    rss(item("Medical imaging AI update", "/one") + item("Medical imaging AI update", "/two")),
    source,
    now,
    365,
  );
  assert.equal(parsed.records.length, 2);
  const records = new Map<string, ResearchSignal>();
  for (const row of parsed.records) mergePublisherNews(records, row);
  assert.equal(records.size, 2);
  const base = parsed.records[0];
  mergePublisherNews(records, {
    ...base,
    id: "news:old-headline",
    originalUrl: null,
    url: "https://news.google.com/rss/articles/old",
    publishedAt: "2026-09-01T09:00:00Z",
  });
  assert.equal(records.size, 3, "identical headline from another date is distinct");
});

test("empty publisher excerpts do not relabel retained search summaries or erase source timestamps", () => {
  const direct = parsePublisherFeed(rss(), source, now, 365).records[0];
  const google: NewsSignal = {
    ...direct,
    id: "news:existing",
    sourceId: "google-news-imaging",
    originalUrl: null,
    summary: "Search snippet",
    summaryKind: "search-snippet",
    url: "https://news.google.com/rss/articles/test",
  };
  const records = new Map<string, ResearchSignal>([[google.id, google]]);
  mergePublisherNews(records, { ...direct, summary: "", updatedAt: "2026-10-15T10:00:00Z" });
  let row = records.get(google.id) as NewsSignal;
  assert.equal(row.summaryKind, "search-snippet");
  assert.equal(row.summary, "Search snippet");
  assert.equal(row.sourceId, source.id);
  mergePublisherNews(records, google);
  row = records.get(google.id) as NewsSignal;
  assert.equal(row.sourceId, source.id);
  assert.equal(row.updatedAt, "2026-10-15T10:00:00Z");
});

test("impossible calendar dates and future Atom updates are never silently normalized", () => {
  assert.throws(() =>
    parsePublisherFeed(
      rss(item("Medical imaging AI model", "/bad", "Mon, 30 Feb 2026 09:00:00 GMT")),
      source,
      now,
      365,
    ),
  );
  const atom =
    '<feed><title>Example</title><entry><title>Medical imaging AI model</title><link href="https://example.org/news/model"/><published>2026-10-01T09:00:00Z</published><updated>2027-01-01T09:00:00Z</updated></entry></feed>';
  assert.equal(parsePublisherFeed(atom, source, now, 365).records[0].updatedAt, null);
  assert.throws(() =>
    parsePublisherFeed(atom.replace("2026-10-01T09:00:00Z", "2026-02-30T09:00:00Z"), source, now, 365),
  );
});

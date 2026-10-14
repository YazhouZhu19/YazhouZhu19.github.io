import { test } from "node:test";
import assert from "node:assert/strict";
import { collectResearchSignals, createSignalFetcher, CURATED_REPOSITORIES, googleNewsUrl, isGitHubProjectRelevant, isNewsProgressRelevant, NEWS_QUERIES, parseGitHubRepository, parseGoogleNewsRss, publicRelatedUrls, type SignalFetch } from "../lib/collect-signals";
import { emptyResearchSignalsData, parseResearchSignalsData, safeSignalUrl, signalDate } from "../lib/research-signals";

const now = "2026-10-14T04:00:00.000Z";
const repo = (fullName = "Project-MONAI/MONAI") => ({ full_name: fullName, private: false, html_url: `https://github.com/${fullName}`, description: "Medical imaging AI toolkit", created_at: "2020-01-01T00:00:00Z", updated_at: now, pushed_at: now, topics: ["medical-imaging"], stargazers_count: 20, forks_count: 2, open_issues_count: 3, archived: false, license: { spdx_id: "Apache-2.0" }, language: "Python" });
const item = (title = "New medical imaging AI model", publisher = "Example Research", day = "Wed, 14 Oct 2026 02:00:00 GMT") => `<item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/test</link><pubDate>${day}</pubDate><description>&lt;a href="https://news.google.com/rss/articles/test"&gt;${title}&lt;/a&gt;</description><source url="https://example.com">${publisher}</source></item>`;
const rss = (items = item()) => `<rss version="2.0"><channel><title>Google News</title><link>https://news.google.com/</link>${items}</channel></rss>`;
const discovery = googleNewsUrl(NEWS_QUERIES[0], 365);
const fakeFetch: SignalFetch = async url => {
  const parsed = new URL(url);
  if (parsed.hostname === "news.google.com") return { body: rss(), status: 200 };
  if (parsed.pathname === "/search/repositories") return { body: JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), status: 200 };
  if (/\/readme$/.test(parsed.pathname)) return { body: JSON.stringify({ encoding: "base64", content: Buffer.from("Medical imaging toolkit. [Paper](https://arxiv.org/abs/2401.12345)").toString("base64") }), status: 200 };
  if (/\/releases\/latest$/.test(parsed.pathname)) return { body: "", status: 404 };
  return { body: JSON.stringify(repo(parsed.pathname.slice(7))), status: 200 };
};

test("schema rejects duplicate IDs, unsafe URLs, missing provenance and unexpected data", () => {
  const record = parseGitHubRepository(repo(), now);
  const source = { id: "github-public", name: "GitHub", kind: "github", url: "https://api.github.com/search/repositories", status: "ok", checkedAt: now, lastSuccessAt: now, received: 1, retained: 1, error: null, coverage: "Public" };
  const data = { ...emptyResearchSignalsData(now), records: [record], sources: [source] };
  assert.equal(parseResearchSignalsData(data).records.length, 1);
  assert.throws(() => parseResearchSignalsData({ ...data, records: [record, record] }));
  assert.throws(() => parseResearchSignalsData({ ...data, sources: [] }));
  assert.throws(() => parseResearchSignalsData({ ...data, apiKey: "forbidden" }));
  for (const url of ["javascript:alert(1)", "http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://user:pass@example.com/x"]) assert.equal(safeSignalUrl(url), false);
});
test("GitHub metadata never accepts private repositories or fabricated counters", () => {
  assert.throws(() => parseGitHubRepository({ ...repo(), private: true }, now));
  assert.throws(() => parseGitHubRepository({ ...repo(), stargazers_count: -1 }, now));
  assert.throws(() => parseGitHubRepository({ ...repo(), html_url: "https://evil.example/MONAI" }, now));
  const record = parseGitHubRepository(repo(), now);
  assert.equal(record.license, "Apache-2.0"); assert.equal(signalDate(record), now);
  assert.equal(record.id, "github:project-monai/monai");
});
test("Google RSS retains publisher/date/discovery while clearly marking unverified snippets", () => {
  const { records, received } = parseGoogleNewsRss(rss(), "google-news-imaging", discovery, now, 365);
  assert.equal(received, 1); assert.equal(records.length, 1);
  assert.equal(records[0].publisher, "Example Research"); assert.equal(records[0].title, "New medical imaging AI model");
  assert.equal(records[0].summaryKind, "search-snippet"); assert.equal(records[0].originalUrl, null);
  assert.equal(records[0].discoveryUrl, discovery); assert.equal(records[0].publishedAt, "2026-10-14T02:00:00.000Z");
  assert(!records[0].summary.includes("<a")); assert.deepEqual(records[0].relatedUrls, []);
});
test("RSS filtering rejects irrelevant, old/future content and AI substring false positives", () => {
  const body = rss(item("General language AI model") + item("Medical imaging failure training") + item("Medical imaging AI model", "Old", "Wed, 01 Jan 2020 02:00:00 GMT") + item("Medical imaging AI model", "Future", "Wed, 01 Jan 2031 02:00:00 GMT") + item("医学影像新模型发布", "公开新闻"));
  const result = parseGoogleNewsRss(body, "google-news-imaging", discovery, now, 365);
  assert.equal(result.received, 5); assert.equal(result.records.length, 1); assert.equal(result.records[0].publisher, "公开新闻");
});
test("project and progress filters exclude clear coursework, portfolios and financial/personnel news", () => {
  for (const summary of ["Medical imaging course assignment 2", "Medical image analysis portfolio", "Notes and open discussion on medical imaging papers"]) assert.equal(isGitHubProjectRelevant({ fullName: "user/project", summary, topics: [] }), false);
  assert.equal(isGitHubProjectRelevant({ fullName: "lab/imaging", summary: "Medical imaging segmentation toolkit", topics: [] }), true);
  for (const title of ["Perimeter Medical Imaging AI Appoints Michelle Caron to Board of Directors", "AI in Medical Imaging Market Size", "医学影像大模型第一股登陆港交所", "德适-B(02526.HK)：医学影像大模型专精龙头，范式升级驱动增长提速", "Top AI in Radiology Companies Transforming Medical Imaging and Diagnostics"]) assert.equal(isNewsProgressRelevant(title), false);
  assert.equal(isNewsProgressRelevant("Researchers release open AI model for medical imaging"), true);
});
test("empty valid RSS is distinct from blank, malformed, HTML and truncated responses", () => {
  assert.equal(parseGoogleNewsRss(rss(""), "google-news-imaging", discovery, now, 365).records.length, 0);
  for (const body of ["", "<html>rate limited</html>", rss().replace("</rss>", ""), rss().replace("</item>", ""), rss(item().replace(/<pubDate>.*?<\/pubDate>/, ""))]) assert.throws(() => parseGoogleNewsRss(body, "google-news-imaging", discovery, now, 365));
});
test("public relationship URLs deduplicate and exclude executable/local links", () => {
  assert.deepEqual(publicRelatedUrls("[a](https://arxiv.org/abs/2401.12345) https://arxiv.org/abs/2401.12345 https://localhost/x javascript:alert(1)"), ["https://arxiv.org/abs/2401.12345"]);
});
test("collection deduplicates queries, enriches readmes and preserves first-seen on failure", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), { fetchText: fakeFetch, now: new Date(now), force: true });
  assert.equal(first.allFailed, false); assert.equal(first.data.records.filter(record => record.kind === "news").length, 1);
  assert.equal(first.data.records.filter(record => record.kind === "github").length, CURATED_REPOSITORIES.length);
  assert(first.data.records.filter(record => record.kind === "github").every(record => record.relatedUrls.includes("https://arxiv.org/abs/2401.12345")));
  const failed = await collectResearchSignals(first.data, { fetchText: async () => { throw new Error("secret should never leak"); }, now: new Date("2026-10-15T04:00:00Z"), force: true });
  assert.equal(failed.allFailed, true); assert.deepEqual(failed.data.records, first.data.records);
  assert(failed.data.sources.every(source => source.status === "error" && source.lastSuccessAt === now));
  assert(!JSON.stringify(failed.data).includes("secret"));
});
test("six-hour cache never advances source or record observation timestamps", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), { fetchText: fakeFetch, now: new Date(now), force: true });
  const cached = await collectResearchSignals(first.data, { fetchText: async () => { throw new Error("must not fetch"); }, now: new Date("2026-10-14T05:00:00Z") });
  assert.deepEqual(cached.data.sources, first.data.sources); assert.deepEqual(cached.data.records, first.data.records);
  assert.equal(cached.data.generatedAt, "2026-10-14T05:00:00.000Z"); assert.equal(cached.allFailed, false);
});
test("HTTP requester never sends token to Google, refuses redirects and bounds bodies", async () => {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (input, options) => { calls.push({ url: String(input), options }); return new Response("<rss/>", { status: 200 }); };
  const request = createSignalFetcher("test-private-token", fetcher);
  await request(discovery); await request("https://api.github.com/repos/Project-MONAI/MONAI");
  assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, undefined);
  assert.equal((calls[1].options?.headers as Record<string, string>).Authorization, "Bearer test-private-token");
  assert(calls.every(call => call.options?.redirect === "error"));
  await assert.rejects(() => request("https://example.com/"));
  await assert.rejects(() => createSignalFetcher(undefined, async () => new Response(""))(discovery), /为空/);
  await assert.rejects(() => createSignalFetcher(undefined, async () => new Response("x", { headers: { "content-length": "5000000" } }))(discovery), /上限/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectResearchSignals,
  createSignalFetcher,
  CURATED_REPOSITORIES,
  GITHUB_ENRICHMENT_LIMIT,
  GITHUB_RESULTS_PER_QUERY,
  GITHUB_SEARCH_REQUEST_BUDGET,
  githubSearchPlan,
  githubDiscoveryCacheUrl,
  SignalRateLimitError,
  googleNewsUrl,
  isGitHubProjectRelevant,
  isNewsProgressRelevant,
  NEWS_QUERIES,
  parseGitHubRepository,
  parseGoogleNewsRss,
  publicRelatedUrls,
  type SignalFetch,
} from "../lib/collect-signals";
import { GITHUB_DISCOVERY_GROUPS } from "../lib/github-discovery";
import { evaluateGitHubRelevance } from "../lib/signal-relevance";
import {
  emptyResearchSignalsData,
  parseResearchSignalsData,
  safeSignalUrl,
  signalDate,
  type ResearchSignalsData,
  type SignalSourceState,
} from "../lib/research-signals";
import { validateSignalCollection } from "../scripts/check-signal-collection";
import { NEWS_FEED_SOURCES } from "../lib/news-sources";

const now = "2026-10-14T04:00:00.000Z";
const repo = (fullName = "Project-MONAI/MONAI") => ({
  full_name: fullName,
  private: false,
  html_url: `https://github.com/${fullName}`,
  description: "Medical imaging AI toolkit",
  created_at: "2020-01-01T00:00:00Z",
  updated_at: now,
  pushed_at: now,
  topics: ["medical-imaging"],
  stargazers_count: 20,
  forks_count: 2,
  open_issues_count: 3,
  archived: false,
  license: { spdx_id: "Apache-2.0" },
  language: "Python",
});
const item = (
  title = "New medical imaging AI model",
  publisher = "Example Research",
  day = "Wed, 14 Oct 2026 02:00:00 GMT",
) =>
  `<item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/test</link><pubDate>${day}</pubDate><description>&lt;a href="https://news.google.com/rss/articles/test"&gt;${title}&lt;/a&gt;</description><source url="https://example.com">${publisher}</source></item>`;
const rss = (items = item()) =>
  `<rss version="2.0"><channel><title>Google News</title><link>https://news.google.com/</link>${items}</channel></rss>`;
const discovery = googleNewsUrl(NEWS_QUERIES[0], 365);
const fakeFetch: SignalFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === "news.google.com") return { body: rss(), status: 200 };
  if (NEWS_FEED_SOURCES.some((source) => source.url === url)) return { body: rss(""), status: 200 };
  if (parsed.pathname === "/search/repositories")
    return { body: JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), status: 200 };
  if (/\/readme$/.test(parsed.pathname))
    return {
      body: JSON.stringify({
        encoding: "base64",
        content: Buffer.from("Medical imaging toolkit. [Paper](https://arxiv.org/abs/2401.12345)").toString(
          "base64",
        ),
      }),
      status: 200,
    };
  if (/\/releases\/latest$/.test(parsed.pathname)) return { body: "", status: 404 };
  return { body: JSON.stringify(repo(parsed.pathname.slice(7))), status: 200 };
};
function completedNewsCache(data: ResearchSignalsData): ResearchSignalsData {
  return {
    ...data,
    sources: data.sources.map((source) =>
      source.kind === "news"
        ? { ...source, status: "ok", checkedAt: now, lastSuccessAt: now, error: null }
        : source,
    ),
    discoveryState: {
      ...data.discoveryState,
      news: {
        ...data.discoveryState!.news!,
        queue: [],
        recentCheckedAt: Object.fromEntries(NEWS_QUERIES.map((query) => [query.id, now])),
      },
    },
  };
}

test("schema rejects duplicate IDs, unsafe URLs, missing provenance and unexpected data", () => {
  const record = parseGitHubRepository(repo(), now);
  const source = {
    id: "github-public",
    name: "GitHub",
    kind: "github",
    url: "https://api.github.com/search/repositories",
    status: "ok",
    checkedAt: now,
    lastSuccessAt: now,
    received: 1,
    retained: 1,
    error: null,
    coverage: "Public",
  };
  const data = { ...emptyResearchSignalsData(now), records: [record], sources: [source] };
  assert.equal(parseResearchSignalsData(data).records.length, 1);
  assert.throws(() => parseResearchSignalsData({ ...data, records: [record, record] }));
  assert.throws(() => parseResearchSignalsData({ ...data, sources: [] }));
  assert.throws(() => parseResearchSignalsData({ ...data, apiKey: "forbidden" }));
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@example.com/x",
  ])
    assert.equal(safeSignalUrl(url), false);
});
test("publication validation evaluates actual attempts despite cached and pending sources", () => {
  const next = "2026-10-14T05:00:00.000Z";
  const cached: SignalSourceState = {
    id: "github-public",
    name: "GitHub",
    kind: "github",
    url: "https://api.github.com/search/repositories",
    status: "ok",
    checkedAt: now,
    lastSuccessAt: now,
    received: 0,
    retained: 0,
    error: null,
    coverage: "Cached",
  };
  const stale: SignalSourceState = { ...cached, id: "news-existing", kind: "news", url: discovery };
  const pending: SignalSourceState = {
    ...stale,
    id: "news-new",
    status: "pending",
    checkedAt: null,
    lastSuccessAt: null,
  };
  const before = { ...emptyResearchSignalsData(now), sources: [cached, stale] };
  const after = {
    ...before,
    generatedAt: next,
    sources: [
      cached,
      { ...stale, status: "error" as const, checkedAt: next, error: "Source failed" },
      pending,
    ],
  };
  assert.doesNotThrow(() => validateSignalCollection(before, after, next, "1"));
  assert.throws(() => validateSignalCollection(before, after, next, "0"), /every attempted source/);
  const noAttempts = { ...after, sources: [cached, stale, pending] };
  assert.doesNotThrow(() => validateSignalCollection(before, noAttempts, next, "0"));
  assert.throws(() => validateSignalCollection(before, noAttempts, next, "1"), /every attempted source/);
  const partial = {
    ...after,
    sources: [
      cached,
      { ...stale, status: "partial" as const, checkedAt: next, lastSuccessAt: next },
      pending,
    ],
  };
  assert.doesNotThrow(() => validateSignalCollection(before, partial, next, "0"));
  assert.throws(() => validateSignalCollection(before, partial, next, "1"), /every attempted source/);
});
test("GitHub metadata never accepts private repositories or fabricated counters", () => {
  assert.throws(() => parseGitHubRepository({ ...repo(), private: true }, now));
  assert.throws(() => parseGitHubRepository({ ...repo(), stargazers_count: -1 }, now));
  assert.throws(() => parseGitHubRepository({ ...repo(), html_url: "https://evil.example/MONAI" }, now));
  const record = parseGitHubRepository(repo(), now);
  assert.equal(record.license, "Apache-2.0");
  assert.equal(signalDate(record), now);
  assert.equal(record.id, "github:project-monai/monai");
});
test("Google RSS retains publisher/date/discovery while clearly marking unverified snippets", () => {
  const { records, received } = parseGoogleNewsRss(rss(), "google-news-imaging", discovery, now, 365);
  assert.equal(received, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].publisher, "Example Research");
  assert.equal(records[0].title, "New medical imaging AI model");
  assert.equal(records[0].summaryKind, "search-snippet");
  assert.equal(records[0].originalUrl, null);
  assert.equal(records[0].discoveryUrl, discovery);
  assert.equal(records[0].publishedAt, "2026-10-14T02:00:00.000Z");
  assert(!records[0].summary.includes("<a"));
  assert.deepEqual(records[0].relatedUrls, []);
});
test("RSS filtering rejects irrelevant, old/future content and AI substring false positives", () => {
  const body = rss(
    item("General language AI model") +
      item("Medical imaging failure training") +
      item("Medical imaging AI model", "Old", "Wed, 01 Jan 2020 02:00:00 GMT") +
      item("Medical imaging AI model", "Future", "Wed, 01 Jan 2031 02:00:00 GMT") +
      item("医学影像新模型发布", "公开新闻"),
  );
  const result = parseGoogleNewsRss(body, "google-news-imaging", discovery, now, 365);
  assert.equal(result.received, 5);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].publisher, "公开新闻");
});
test("medical coursework, portfolios and domain-related business news remain candidates", () => {
  for (const summary of [
    "Medical imaging course assignment 2",
    "Medical image analysis portfolio",
    "Notes and open discussion on medical imaging papers",
  ])
    assert.equal(
      evaluateGitHubRelevance({ fullName: "user/project", summary, topics: [] })?.level,
      "candidate",
    );
  assert.equal(
    isGitHubProjectRelevant({
      fullName: "lab/imaging",
      summary: "Medical imaging segmentation toolkit",
      topics: [],
    }),
    true,
  );
  for (const title of [
    "Perimeter Medical Imaging AI Appoints Michelle Caron to Board of Directors",
    "AI in Medical Imaging Market Size",
    "医学影像大模型第一股登陆港交所",
    "德适-B(02526.HK)：医学影像大模型专精龙头，范式升级驱动增长提速",
    "Top AI in Radiology Companies Transforming Medical Imaging and Diagnostics",
  ])
    assert.equal(isNewsProgressRelevant(title), true);
  assert.equal(isNewsProgressRelevant("Researchers release open AI model for medical imaging"), true);
});
test("empty valid RSS is distinct from blank, malformed, HTML and truncated responses", () => {
  assert.equal(parseGoogleNewsRss(rss(""), "google-news-imaging", discovery, now, 365).records.length, 0);
  for (const body of [
    "",
    "<html>rate limited</html>",
    rss().replace("</rss>", ""),
    rss().replace("</item>", ""),
    rss(item().replace(/<pubDate>.*?<\/pubDate>/, "")),
  ])
    assert.throws(() => parseGoogleNewsRss(body, "google-news-imaging", discovery, now, 365));
});
test("public relationship URLs deduplicate and exclude executable/local links", () => {
  assert.deepEqual(
    publicRelatedUrls(
      "[a](https://arxiv.org/abs/2401.12345) https://arxiv.org/abs/2401.12345 https://localhost/x javascript:alert(1)",
    ),
    ["https://arxiv.org/abs/2401.12345"],
  );
});
test("collection deduplicates queries, enriches readmes and preserves first-seen on failure", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
    githubToken: "test",
  });
  assert.equal(first.allFailed, false);
  assert.equal(first.data.records.filter((record) => record.kind === "news").length, 1);
  assert.equal(
    first.data.records.filter((record) => record.kind === "github").length,
    CURATED_REPOSITORIES.length,
  );
  assert(
    first.data.records.some((record) => record.relatedUrls.includes("https://arxiv.org/abs/2401.12345")),
  );
  assert(
    first.data.records.filter((record) => record.relatedUrls.includes("https://arxiv.org/abs/2401.12345"))
      .length <= GITHUB_ENRICHMENT_LIMIT,
  );
  const failed = await collectResearchSignals(first.data, {
    fetchText: async () => {
      throw new Error("secret should never leak");
    },
    now: new Date("2026-10-15T04:00:00Z"),
    force: true,
  });
  assert.equal(failed.allFailed, true);
  assert.deepEqual(failed.data.records, first.data.records);
  assert(
    failed.data.sources
      .filter((source) => source.checkedAt === "2026-10-15T04:00:00.000Z")
      .every((source) => source.status === "error"),
  );
  assert(
    failed.data.sources.every(
      (source) =>
        source.lastSuccessAt ===
        (first.data.sources.find((previous) => previous.id === source.id)?.lastSuccessAt ?? null),
    ),
  );
  assert(!JSON.stringify(failed.data).includes("secret"));
});
test("six-hour cache never advances source or record observation timestamps", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
  });
  const complete = completedNewsCache(first.data);
  let requests = 0;
  const cached = await collectResearchSignals(complete, {
    fetchText: async () => {
      requests++;
      throw new Error("must not fetch");
    },
    now: new Date("2026-10-14T05:00:00Z"),
  });
  assert.equal(requests, 0);
  assert.deepEqual(
    cached.data.sources.map(({ coverage, ...source }) => source),
    complete.sources.map(({ coverage, ...source }) => source),
  );
  assert.deepEqual(cached.data.records, complete.records);
  assert.equal(cached.data.generatedAt, "2026-10-14T05:00:00.000Z");
  assert.equal(cached.allFailed, false);
});
test("a cached GitHub success and unattempted sources cannot hide failure of all actual news attempts", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
  });
  const complete = completedNewsCache(first.data);
  complete.sources.push({
    id: "news-queued",
    name: "Queued route",
    kind: "news",
    url: "https://news.google.com/rss/search?q=queued",
    status: "pending",
    checkedAt: null,
    lastSuccessAt: null,
    received: 0,
    retained: 0,
    error: null,
    coverage: "Not yet attempted",
  });
  delete complete.discoveryState!.news!.recentCheckedAt![NEWS_QUERIES[0].id];
  const checked: string[] = [];
  const failed = await collectResearchSignals(complete, {
    fetchText: async (url) => {
      checked.push(url);
      throw new Error("Network failed");
    },
    now: new Date("2026-10-14T05:00:00Z"),
  });
  assert.equal(checked.length, 1);
  assert.equal(new URL(checked[0]).hostname, "news.google.com");
  assert.equal(failed.allFailed, true);
  assert.equal(failed.data.sources.find((source) => source.id === "github-public")!.status, "ok");
  assert.equal(failed.data.sources.find((source) => source.id === "news-queued")!.checkedAt, null);
  assert.deepEqual(failed.data.records, complete.records);
  assert.doesNotThrow(() => validateSignalCollection(complete, failed.data, "2026-10-14T05:00:00Z", "1"));
});
test("HTTP requester never sends token to Google, refuses redirects and bounds bodies", async () => {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response("<rss/>", { status: 200 });
  };
  const request = createSignalFetcher("test-private-token", fetcher);
  await request(discovery);
  await request("https://api.github.com/repos/Project-MONAI/MONAI");
  for (const source of NEWS_FEED_SOURCES) await request(source.url);
  assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, undefined);
  assert.equal(
    (calls[1].options?.headers as Record<string, string>).Authorization,
    "Bearer test-private-token",
  );
  assert(
    calls
      .filter((call) => new URL(call.url).hostname !== "api.github.com")
      .every((call) => !(call.options?.headers as Record<string, string>).Authorization),
  );
  for (const source of NEWS_FEED_SOURCES)
    await assert.rejects(() => request(`${source.url}${source.url.includes("?") ? "&" : "?"}unlisted=1`));
  assert(calls.every((call) => call.options?.redirect === "error"));
  await assert.rejects(() => request("https://example.com/"));
  await assert.rejects(() => createSignalFetcher(undefined, async () => new Response(""))(discovery), /为空/);
  await assert.rejects(
    () =>
      createSignalFetcher(
        undefined,
        async () => new Response("x", { headers: { "content-length": "5000000" } }),
      )(discovery),
    /上限/,
  );
});

test("GitHub relevance includes modality/task projects without general medical-imaging wording", () => {
  for (const summary of [
    "MRI reconstruction with learned priors",
    "brain tumor segmentation",
    "CT image registration",
    "retinal OCT classification",
    "lung nodule detection",
    "PET reconstruction benchmark",
    "breast lesion segmentation dataset",
    "Radiomics feature extraction",
    "DICOM viewer",
    "NIfTI processing",
  ])
    assert.equal(isGitHubProjectRelevant({ fullName: "lab/project", summary, topics: [] }), true, summary);
  for (const summary of [
    "Segment anything foundation model",
    "generic LLM inference engine",
    "Stock market prediction",
  ])
    assert.equal(isGitHubProjectRelevant({ fullName: "lab/project", summary, topics: [] }), false, summary);
});
test("search plan covers every direction fairly with bounded requests and both rankings", () => {
  const plan = githubSearchPlan();
  assert(plan.length <= GITHUB_SEARCH_REQUEST_BUDGET);
  assert.deepEqual(
    plan.slice(0, GITHUB_DISCOVERY_GROUPS.length).map((step) => step.groupId),
    GITHUB_DISCOVERY_GROUPS.map((group) => group.id),
  );
  const fullPlan = githubSearchPlan(5000);
  for (const group of GITHUB_DISCOVERY_GROUPS)
    assert.deepEqual(
      fullPlan
        .filter((step) => step.groupId === group.id && step.query === group.queries[0])
        .map((step) => step.sort),
      ["best-match", "updated"],
    );
  assert.equal(githubSearchPlan(5).length, 5);
  assert.throws(() => githubSearchPlan(5001));
});
test("multi-direction search deduplicates across rankings, unions groups and exceeds the former 18 cap", async () => {
  const calls: string[] = [];
  const request: SignalFetch = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname !== "/search/repositories") return fakeFetch(url);
    const groupIndex = GITHUB_DISCOVERY_GROUPS.findIndex((group) =>
      group.queries.includes(parsed.searchParams.get("q")!),
    );
    const items = [
      repo("Shared/imaging"),
      ...Array.from({ length: 10 }, (_, i) => repo(`Lab${groupIndex}/medical-project-${i}`)),
    ];
    return { body: JSON.stringify({ total_count: 100, incomplete_results: false, items }), status: 200 };
  };
  const result = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: request,
    force: true,
    githubOnly: true,
    now: new Date(now),
    githubToken: "test",
  });
  const github = result.data.records.filter((record) => record.kind === "github");
  assert(github.length >= 180);
  assert.deepEqual(
    new Set(github.find((record) => record.fullName === "Shared/imaging")!.discoveryGroups),
    new Set(GITHUB_DISCOVERY_GROUPS.map((group) => group.id)),
  );
  assert.equal(result.data.sources[0].status, "ok");
  assert(calls.every((url) => new URL(url).hostname === "api.github.com"));
  assert(calls.filter((url) => /\/readme$/.test(url)).length <= GITHUB_ENRICHMENT_LIMIT);
  for (const url of calls.filter((url) => new URL(url).pathname === "/search/repositories"))
    assert.equal(Number(new URL(url).searchParams.get("per_page")), GITHUB_RESULTS_PER_QUERY);
  assert(calls.length <= 130);
});
test("GitHub-only refresh preserves news state and ignores a failing unselected source", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
  });
  const newsBefore = first.data.sources.filter((source) => source.kind === "news");
  const result = await collectResearchSignals(first.data, {
    fetchText: async (url) => {
      assert.equal(new URL(url).hostname, "api.github.com");
      throw new Error("unavailable");
    },
    now: new Date("2026-10-15T04:00:00Z"),
    force: true,
    githubOnly: true,
  });
  assert.equal(result.allFailed, true);
  assert.deepEqual(
    result.data.sources.filter((source) => source.kind === "news"),
    newsBefore,
  );
  assert.deepEqual(result.data.records, first.data.records);
});
test("discovery catalog fingerprint invalidates a fresh older search cache", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
  });
  const complete = completedNewsCache(first.data);
  complete.sources.find((source) => source.kind === "github")!.url =
    "https://api.github.com/search/repositories?q=old";
  let githubRequests = 0;
  const refreshed = await collectResearchSignals(complete, {
    fetchText: async (url) => {
      if (new URL(url).hostname === "api.github.com") githubRequests++;
      else assert.fail("news should remain cached");
      return fakeFetch(url);
    },
    now: new Date("2026-10-14T05:00:00Z"),
  });
  assert(githubRequests > 0);
  assert.equal(refreshed.data.sources[0].url, githubDiscoveryCacheUrl());
});
test("partial search failure retains old projects, excerpts, releases and group history", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: fakeFetch,
    now: new Date(now),
    force: true,
    githubToken: "test",
  });
  const original = first.data.records.find((record) => record.kind === "github")!;
  assert.equal(original.kind, "github");
  if (original.kind !== "github") return;
  original.discoveryGroups = ["segmentation"];
  original.releasedAt = now;
  original.releaseUrl = original.url + "/releases/tag/v1";
  const updated = await collectResearchSignals(first.data, {
    fetchText: async (url) => {
      if (new URL(url).pathname === "/search/repositories") throw new Error("unavailable");
      if (/\/readme$/.test(url)) return { body: "", status: 404 };
      return fakeFetch(url);
    },
    now: new Date("2026-10-15T04:00:00Z"),
    force: true,
    githubOnly: true,
  });
  assert.equal(updated.data.sources[0].status, "partial");
  assert.equal(updated.allFailed, false);
  const kept = updated.data.records.find((record) => record.id === original.id)!;
  assert.equal(kept.firstSeenAt, now);
  assert.equal(kept.kind, "github");
  if (kept.kind !== "github") return;
  assert.equal(kept.readmeExcerpt, original.readmeExcerpt);
  assert.equal(kept.releaseUrl, original.releaseUrl);
  assert.deepEqual(kept.discoveryGroups, ["segmentation"]);
  assert(first.data.records.every((old) => updated.data.records.some((record) => record.id === old.id)));
});
test("anonymous collection stays within 60 calls and long rate limits stop follow-up requests", async () => {
  let calls = 0;
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: async (url) => {
      calls++;
      return fakeFetch(url);
    },
    now: new Date(now),
    force: true,
    githubOnly: true,
  });
  assert(calls <= 60);
  assert.equal(first.allFailed, false);
  calls = 0;
  const waits: number[] = [];
  const limited = await collectResearchSignals(first.data, {
    fetchText: async () => {
      calls++;
      throw new SignalRateLimitError(3600000);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    now: new Date("2026-10-15T04:00:00Z"),
    force: true,
    githubOnly: true,
  });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(limited.allFailed, true);
  assert.deepEqual(limited.data.records, first.data.records);
});
test("short rate limits get only one bounded retry and redact server response content", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await collectResearchSignals(emptyResearchSignalsData(now), {
    fetchText: async () => {
      calls++;
      throw new SignalRateLimitError(2000);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    now: new Date(now),
    force: true,
    githubOnly: true,
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.allFailed, true);
  const request = createSignalFetcher(
    "secret-token",
    async () => new Response("secret-server-body", { status: 429, headers: { "retry-after": "2" } }),
  );
  await assert.rejects(
    request("https://api.github.com/search/repositories?q=medical"),
    (error: unknown) =>
      error instanceof SignalRateLimitError &&
      error.retryAfterMs === 2000 &&
      !error.message.includes("secret"),
  );
});

test("403 secondary limits without headers stop safely instead of producing a retry storm", async () => {
  for (const status of [403, 429]) {
    const request = createSignalFetcher(undefined, async () => new Response("untrusted body", { status }));
    await assert.rejects(
      request("https://api.github.com/search/repositories?q=medical"),
      (error: unknown) => error instanceof SignalRateLimitError && error.retryAfterMs >= 60000,
    );
  }
});

test("secondary limit uses one-minute fallback despite a nearby primary reset", async () => {
  const request = createSignalFetcher(
    undefined,
    async () =>
      new Response("untrusted body", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "20",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 5),
        },
      }),
  );
  await assert.rejects(
    request("https://api.github.com/search/repositories?q=medical"),
    (error: unknown) => error instanceof SignalRateLimitError && error.retryAfterMs === 60000,
  );
});

test("discovery preserves paper directories and prototypes as candidates instead of verified projects", () => {
  const candidates = [
    {
      fullName: "albarqouni/Deep-Learning-for-Medical-Applications",
      summary: "Deep Learning Papers on Medical Image Analysis",
    },
    {
      fullName: "amanchadha/coursera-ai-for-medicine-specialization",
      summary:
        "Programming assignments, labs and quizzes for the Coursera AI for Medicine specialization. Medical imaging.",
    },
    {
      fullName: "amirhossein-kz/Awesome-Diffusion-Models-in-Medical-Imaging",
      summary: "Diffusion Models in Medical Imaging: A Comprehensive Survey",
    },
    {
      fullName: "alexandretzy/Prototype-Thesis-1",
      summary:
        "A responsive frontend prototype for medical imaging, with fictional data for demonstration only",
    },
    { fullName: "lab/ADA4MIA", summary: "Awesome Active Domain Adaptation for Medical Image Analysis" },
  ];
  for (const record of candidates)
    assert.equal(evaluateGitHubRelevance({ ...record, topics: [] })?.level, "candidate", record.fullName);
  assert.equal(
    isGitHubProjectRelevant({
      fullName: "foundation/ehr-wallet",
      summary: "Blockchain-based sharing and medical data management",
      topics: ["medical-imaging"],
    }),
    false,
  );
  const retained = [
    "Code for our papers on medical imaging segmentation",
    "Interactive frontend application for DICOM visualization",
    "Hands-on tutorial code for MRI reconstruction",
    "Medical imaging benchmark dataset and training code",
    "Awesome medical imaging inference toolkit",
  ];
  for (const summary of retained)
    assert.equal(isGitHubProjectRelevant({ fullName: "lab/research", summary, topics: [] }), true, summary);
});

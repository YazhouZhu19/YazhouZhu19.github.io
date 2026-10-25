import test from "node:test";
import assert from "node:assert/strict";
import { buildAiMessages, parseAiReport, prepareAiEvidence, type AiSpec } from "../lib/ai-evidence";
import { aiEvidenceBatches, buildAiSynthesis, getAiSettings, runAiAnalysis } from "../lib/ai-client";
import { explicitEvidenceKeys, findRelatedSignals, prepareCombinedAiEvidence } from "../lib/signal-evidence";
import type { GitHubSignal, NewsSignal } from "../lib/research-signals";
import type { Paper } from "../lib/types";

const now = new Date("2026-10-14T04:00:00Z");
const spec: AiSpec = {
  mode: "landscape",
  from: "2026-07-01",
  to: "2026-10-14",
  horizonMonths: 6,
  question: "",
  locale: "en",
};
const paper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id,
  title: "Medical image segmentation",
  abstract: "We assessed external-center images.",
  authors: [],
  affiliations: [],
  doi: null,
  source: "Europe PMC",
  sources: ["Europe PMC"],
  status: "published",
  publishedAt: "2026-10-01",
  updatedAt: null,
  firstSeenAt: "2026-10-14T01:00:00Z",
  venue: null,
  url: `https://example.org/${id}`,
  tasks: [],
  modalities: [],
  organs: [],
  methods: [],
  humanSignals: [],
  evidence: [],
  tracks: [],
  reviewStatus: "unreviewed",
  provenance: [],
  ...patch,
});
const github = (id: string, patch: Partial<GitHubSignal> = {}): GitHubSignal => ({
  id,
  kind: "github",
  title: `lab/${id}`,
  fullName: `lab/${id}`,
  url: `https://github.com/lab/${id}`,
  summary: "Medical image segmentation tool",
  summaryKind: "repository-description",
  publisher: "lab",
  publishedAt: "2025-01-01T00:00:00Z",
  firstSeenAt: "2026-10-14T01:00:00Z",
  observedAt: "2026-10-14T02:00:00Z",
  updatedAt: "2026-10-14T02:00:00Z",
  topics: [],
  sourceId: "github",
  relatedUrls: [],
  relevance: { level: "direct", reasons: ["explicit-medical-imaging"] },
  stars: 100,
  forks: 20,
  openIssues: 3,
  license: "MIT",
  language: "Python",
  archived: false,
  pushedAt: "2026-10-02T00:00:00Z",
  releasedAt: null,
  releaseUrl: null,
  readmeExcerpt: "Source code and example use.",
  ...patch,
});
const news = (id: string, patch: Partial<NewsSignal> = {}): NewsSignal => ({
  id,
  kind: "news",
  title: "Publisher announces imaging model",
  url: `https://news.google.com/rss/articles/${id}`,
  summary: "A search excerpt announces a model.",
  summaryKind: "search-snippet",
  publisher: "Example Publisher",
  publishedAt: "2026-10-03T00:00:00Z",
  firstSeenAt: "2026-10-14T01:00:00Z",
  observedAt: "2026-10-14T02:00:00Z",
  updatedAt: null,
  topics: [],
  sourceId: "google-news",
  relatedUrls: [],
  newsType: "model",
  discoveryUrl: `https://news.google.com/rss/articles/${id}`,
  originalUrl: null,
  relevance: { level: "direct", reasons: ["explicit-medical-imaging"] },
  ...patch,
});

test("paper-only evidence remains identical to the existing path", () => {
  const papers = [paper("a"), paper("b")];
  assert.deepEqual(
    prepareCombinedAiEvidence(papers, [github("repo")], spec, ["paper"], 6, now),
    prepareAiEvidence(papers, spec, 6, now),
  );
  assert.deepEqual(prepareCombinedAiEvidence(papers, [github("repo")], spec, [], 6, now).papers, []);
});

test("broad retrieval candidates do not enter research evidence and rule labels are transparent", () => {
  const records = [
    github("direct", { relevance: { level: "direct", reasons: ["explicit-medical-imaging"] } }),
    github("ambiguous", { relevance: { level: "candidate", reasons: ["ambiguous-domain"] } }),
    news("candidate", { relevance: { level: "candidate", reasons: ["ambiguous-domain"] } }),
  ];
  const result = prepareCombinedAiEvidence([], records, spec, ["github", "news"], 8, now);
  assert.deepEqual(
    result.papers.map((item) => item.signal?.id),
    ["direct"],
  );
  const messages = buildAiMessages(result),
    payload = JSON.parse(messages[1].content);
  assert.equal(payload.evidence[0].retrievalRelevance, "direct");
  assert.deepEqual(payload.evidence[0].relevanceReasons, ["explicit-medical-imaging"]);
  assert.match(messages[0].content, /not human review/);
});

test("unassessed legacy signals stay out of direction and PI evidence even with exact paper links", () => {
  const papers = [paper("linked-paper", { doi: "10.1000/linked" })];
  const relatedUrls = ["https://doi.org/10.1000/linked"];
  const records = [
    github("legacy-repo", { relevance: undefined, relatedUrls }),
    news("legacy-news", { relevance: undefined, relatedUrls }),
    github("direct", { relatedUrls }),
  ];
  for (const mode of ["landscape", "team"] as const) {
    const result = prepareCombinedAiEvidence(papers, records, { ...spec, mode }, ["github", "news"], 8, now);
    assert.deepEqual(
      result.papers.map((item) => item.signal?.id),
      ["direct"],
    );
    assert.equal(result.sourceCoverage!.github.eligible, 1);
    assert.equal(result.sourceCoverage!.news.eligible, 0);
  }
});

test("joint sampling represents every eligible kind without treating counts as independent studies", () => {
  const result = prepareCombinedAiEvidence(
    Array.from({ length: 20 }, (_, i) => paper(`p${i}`)),
    [github("r1"), github("r2"), news("n1"), news("n2")],
    spec,
    ["paper", "github", "news"],
    6,
    now,
  );
  assert.equal(result.totalWorks, 24);
  assert.deepEqual(result.sourceCoverage, {
    paper: { eligible: 20, supplied: 2 },
    github: { eligible: 2, supplied: 2 },
    news: { eligible: 2, supplied: 2 },
  });
  assert.equal(
    result.papers.filter((item) => item.signal).every((item) => item.id.startsWith("signal:")),
    true,
  );
  assert.equal(result.sampled, true);
  assert.deepEqual(aiEvidenceBatches(result, true).flat(), result.papers);
  const messages = buildAiMessages(result),
    envelope = JSON.parse(messages[1].content);
  assert.equal(envelope.papers, undefined);
  assert.equal(
    envelope.evidence.find((item: { kind: string }) => item.kind === "news").summaryKind,
    "search-snippet",
  );
  assert.equal(
    envelope.evidence.find((item: { kind: string }) => item.kind === "news").originalContentVerified,
    false,
  );
  assert.match(messages[0].content, /Google is discovery, not publisher/);
  assert.match(messages[0].content, /not independent corroboration/);
  assert.match(messages[0].content, /Stars\/forks\/commits are NOT scientific quality/);
  assert.match(envelope.coverage.selection, /counts are not independent studies/);
});

test("mutable snapshots cannot leak current README or search snippets into historical windows", () => {
  const records = [
    github("repo", { pushedAt: "2026-09-02T00:00:00Z", readmeExcerpt: "FUTURE CHANGE" }),
    news("news", { publishedAt: "2026-09-03T00:00:00Z", summary: "LATER SEARCH SNIPPET" }),
  ];
  const historical = prepareCombinedAiEvidence(
    [],
    records,
    { ...spec, to: "2026-09-30" },
    ["github", "news"],
    6,
    now,
  );
  assert.equal(historical.excludedUnobserved, 2);
  assert.equal(historical.papers.length, 0);
  assert.doesNotMatch(JSON.stringify(buildAiMessages(historical)), /FUTURE CHANGE|LATER SEARCH SNIPPET/);
  const futureObservation = prepareCombinedAiEvidence(
    [],
    [github("r", { observedAt: "2026-10-14T18:00:00Z" })],
    spec,
    ["github"],
    6,
    now,
  );
  assert.equal(futureObservation.excludedUnobserved, 1, "observation uses Beijing day, not UTC slice");
});

test("date selection uses repo activity separately from creation and observation, and excludes unknown news dates", () => {
  const result = prepareCombinedAiEvidence(
    [],
    [
      github("active"),
      github("old", { pushedAt: "2025-01-01T00:00:00Z" }),
      news("nodate", { publishedAt: null }),
      news("future", { publishedAt: "2026-10-15T00:00:00Z" }),
    ],
    spec,
    ["github", "news"],
    6,
    now,
  );
  assert.deepEqual(
    result.papers.map((item) => item.signal?.id),
    ["active"],
  );
  assert.equal(result.excludedInvalid, 1);
  assert.equal(result.excludedFuture, 1);
  assert.notEqual(result.papers[0].publishedAt, result.papers[0].signal?.publishedAt);
});

test("exact DOI/arxiv/repository links associate signals, while names and topics do not", () => {
  const rows = [
    paper("a", {
      doi: "10.1000/ABC",
      abstract: "Code at https://github.com/Lab/Repo/tree/main. Author Jane.",
    }),
    paper("b", { arxivId: "2601.12345v3" }),
  ];
  const records = [
    github("repo", { relatedUrls: ["https://doi.org/10.1000/abc"] }),
    github("repo-url", { url: "https://github.com/lab/repo" }),
    news("arxiv", { relatedUrls: ["https://arxiv.org/pdf/2601.12345v2.pdf"] }),
    github("unlinked", {
      publisher: "Jane",
      title: "Medical image segmentation",
      fullName: "Jane/segmentation",
    }),
  ];
  const associated = findRelatedSignals(rows, records);
  assert.deepEqual(
    associated.map((item) => item.signal.id),
    ["repo", "repo-url", "arxiv"],
  );
  assert.deepEqual(associated[0].paperIds, ["a"]);
  assert.deepEqual(associated[2].paperIds, ["b"]);
  assert.ok(associated[0].basis.includes("doi:10.1000/abc"));
  assert.ok(
    explicitEvidenceKeys(["https://github.com/Lab/Repo.git?tab=readme"]).includes("url:github.com/lab/repo"),
  );
  assert.deepEqual(
    findRelatedSignals(rows, [github("prefix", { url: "https://github.com/lab/repository" })]),
    [],
  );
  assert.equal(explicitEvidenceKeys(["https://github.com/lab"]).length, 0);
});

test("PI analysis admits explicit links only, and does not use future paper versions for association", () => {
  const rows = [
    paper("a", { doi: "10.1000/a" }),
    paper("future-paper", { doi: "10.1000/future", publishedAt: "2026-10-15" }),
  ];
  const records = [
    github("linked", { relatedUrls: ["https://doi.org/10.1000/a"] }),
    github("unlinked"),
    news("future-linked", { relatedUrls: ["https://doi.org/10.1000/future"] }),
  ];
  const result = prepareCombinedAiEvidence(
    rows,
    records,
    { ...spec, mode: "team" },
    ["github", "news"],
    6,
    now,
  );
  assert.deepEqual(
    result.papers.map((item) => item.signal?.id),
    ["linked"],
  );
});

test("same URL snapshots are deduplicated within kind, with content changes invalidating the result key", () => {
  const first = news("a"),
    duplicate = news("b", { url: first.url });
  const result = prepareCombinedAiEvidence([], [first, duplicate], spec, ["news"], 6, now);
  assert.equal(result.totalWorks, 1);
  assert.equal(result.totalRecords, 2);
  assert.equal(result.duplicatesRemoved, 1);
  const changed = prepareCombinedAiEvidence(
    [],
    [{ ...first, summary: "Changed public text" }],
    spec,
    ["news"],
    6,
    now,
  );
  assert.notEqual(result.key, changed.key);
});

test("batch metadata reports actual kinds and synthesis preserves citation kind and snippet uncertainty", () => {
  const data = prepareCombinedAiEvidence(
    [paper("a")],
    [github("r"), news("n")],
    spec,
    ["paper", "github", "news"],
    6,
    now,
  );
  const snippet = data.papers.find((item) => item.signal?.kind === "news")!;
  const messages = buildAiMessages({ ...data, papers: [snippet] });
  const envelope = JSON.parse(messages[1].content);
  assert.equal(envelope.coverage.byKind.news.suppliedInThisBatch, 1);
  assert.equal(envelope.coverage.byKind.paper.suppliedInThisBatch, 0);
  const report = {
    summary: "Limited news claim",
    findings: [
      {
        title: "Model announcement",
        kind: "method" as const,
        observation: "The publisher claims a new model.",
        forecast: "The claim could be tested.",
        alternative: "The announcement may be selective.",
        nextStep: "Verify the original release and evaluate.",
        paperIds: [snippet.id],
      },
    ],
    limitations: ["The original article is unverified."],
  };
  assert.deepEqual(
    parseAiReport(
      JSON.stringify(report),
      data.papers.map((item) => item.id),
    ),
    report,
  );
  assert.throws(() => parseAiReport(JSON.stringify(report), ["a"]), /outside the supplied evidence/);
  const synthesis = JSON.parse(buildAiSynthesis(data, [report], true).messages[1].content);
  assert.deepEqual(synthesis.references, [
    { id: snippet.id, kind: "news", snippetOnly: true, linkedPaperIds: [] },
  ]);
});

test("Chinese mixed evidence remains bounded and no private paper fields enter a cloud payload", () => {
  const data = prepareCombinedAiEvidence(
    [
      paper("a", {
        abstract: "医学影像分析".repeat(200),
        authorString: "PRIVATE WATCHLIST",
        reviewStatus: "PRIVATE NOTE",
      }),
    ],
    [
      github("r", { summary: "医学研究".repeat(200), readmeExcerpt: "医学影像模型".repeat(160) }),
      news("n", { summary: "医学研究".repeat(200) }),
    ],
    spec,
    ["paper", "github", "news"],
    6,
    now,
  );
  assert.deepEqual(aiEvidenceBatches(data, true).flat(), data.papers);
  assert.doesNotMatch(JSON.stringify(buildAiMessages(data)), /PRIVATE WATCHLIST|PRIVATE NOTE/);
});

test("mixed cloud analysis accepts only supplied typed citations and records the actual model", async () => {
  const data = prepareCombinedAiEvidence(
    [paper("a")],
    [github("r"), news("n")],
    spec,
    ["paper", "github", "news"],
    6,
    now,
  );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const config = { ...getAiSettings(), provider: "openrouter" as const, apiKey: "test-key", paid: false };
  const answer = {
    summary: "A research result, code snapshot and unverified announcement offer different signals.",
    findings: [
      {
        title: "Check implementation and evidence separately",
        kind: "method",
        observation: "These records describe a paper, available code and a publisher claim.",
        forecast: "External validation could test a common technical approach.",
        alternative: "These records may describe the same underlying work.",
        nextStep: "Read the original article and run an independent evaluation.",
        paperIds: data.papers.map((item) => item.id),
      },
    ],
    limitations: ["News is only an unverified search excerpt; code activity is not quality."],
  };
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(
        request.messages.find((message: { role: string }) => message.role === "user").content,
      );
      assert.deepEqual(
        new Set(input.evidence.map((item: { kind: string }) => item.kind)),
        new Set(["paper", "github", "news"]),
      );
      assert.equal(input.papers, undefined);
      assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0 });
      return new Response(
        JSON.stringify({
          model: "actual/free-model",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }],
        }),
        { status: 200 },
      );
    };
    const result = await runAiAnalysis(data, config, {
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    assert.equal(calls, 1);
    assert.equal(result.model, "actual/free-model");
    assert.deepEqual(
      result.report.findings[0].paperIds,
      data.papers.map((item) => item.id),
    );
    answer.findings[0].paperIds.push("signal:news:invented");
    await assert.rejects(
      runAiAnalysis(data, config, { signal: new AbortController().signal, onProgress: () => {} }),
      /citation validation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

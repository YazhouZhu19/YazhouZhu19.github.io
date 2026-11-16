import test from "node:test";
import assert from "node:assert/strict";
import { analyzePaperCodeLinks, codeLinkTokens } from "../lib/paper-code-links";
import type { Paper } from "../lib/types";
import type { ResearchSignal } from "../lib/research-signals";

const asOf = "2026-11-16";
test("tokenizer retains CT and MR medical modalities without retaining generic short words", () => {
  assert.deepEqual(codeLinkTokens("CT MR MRI in an US ultrasound"), ["ct", "mr", "mri", "ultrasound"]);
});
const paper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id,
  title: "Retinal vessel topology tracing",
  abstract: "Retinal vessel topology tracing with connectivity reconstruction.",
  authors: [],
  affiliations: [],
  doi: `10.1000/${id}`,
  source: "Europe PMC",
  sources: ["Europe PMC"],
  status: "published",
  publishedAt: "2026-01-01",
  updatedAt: null,
  firstSeenAt: "2026-01-01",
  venue: null,
  url: `https://doi.org/10.1000/${id}`,
  tasks: [],
  modalities: [],
  organs: [],
  methods: [],
  humanSignals: [],
  evidence: [],
  tracks: [],
  scope: "core",
  reviewStatus: "unreviewed",
  provenance: [],
  ...patch,
});
type Repo = Extract<ResearchSignal, { kind: "github" }>;
const repo = (id: string, patch: Partial<Repo> = {}): Repo => ({
  id,
  kind: "github",
  title: "Retinal vessel topology",
  summary: "Retinal vessel tracing and connectivity.",
  summaryKind: "repository-description",
  url: `https://github.com/lab/${id}`,
  publisher: "lab",
  publishedAt: "2023-01-01T00:00:00Z",
  firstSeenAt: "2026-01-01T00:00:00Z",
  observedAt: "2026-11-01T00:00:00Z",
  updatedAt: null,
  topics: [],
  sourceId: "test",
  relatedUrls: [],
  relevance: { level: "direct", reasons: ["test"] },
  fullName: `lab/${id}`,
  stars: 0,
  forks: 0,
  openIssues: 0,
  license: null,
  language: null,
  archived: false,
  pushedAt: "2026-10-01T00:00:00Z",
  releasedAt: null,
  releaseUrl: null,
  readmeExcerpt: "",
  ...patch,
});
const run = (papers: Paper[], signals: ResearchSignal[]) => analyzePaperCodeLinks({ papers, signals, asOf });

test("explicit DOI, arXiv and normalized repository URLs stay separate from lexical suggestions", () => {
  const p = paper("p", {
    doi: "10.1000/ARTICLE",
    arxivId: "2401.12345v2",
    abstract: "Retinal vessel tracing. Code: https://github.com/LAB/code.git/tree/main.",
  });
  const result = run(
    [p],
    [
      repo("doi", { relatedUrls: ["https://dx.doi.org/10.1000/article"] }),
      repo("arxiv", { relatedUrls: ["https://arxiv.org/pdf/2401.12345v3.pdf"] }),
      repo("code"),
    ],
  );
  assert.deepEqual(
    result.links[0].explicit.map((r) => r.id),
    ["arxiv", "code", "doi"],
  );
  assert.equal(result.links[0].candidates.length, 0);
  assert.equal(result.stats.explicitPapers, 1);
  assert.equal(result.stats.candidatePapers, 0);
});

test("DOI URL query strings and fragments do not hide explicit evidence", () => {
  const result = run(
    [paper("p", { doi: "10.1000/p" })],
    [repo("doi", { relatedUrls: ["https://doi.org/10.1000/p?utm_source=journal#article"] })],
  );
  assert.equal(result.links[0].explicit[0]?.id, "doi");
});

test("legacy arXiv PDF links match full-URL metadata and native-ID-only papers", () => {
  const linked = repo("legacy", {
    relatedUrls: ["https://www.arxiv.org/pdf/cs/0601001v2.pdf?download=1#page=3"],
  });
  for (const p of [
    paper("metadata", { doi: null, arxivId: "https://arxiv.org/abs/cs/0601001v3?source=library#abstract" }),
    paper("arxiv:cs/0601001v4", { doi: null, arxivId: undefined }),
  ]) {
    const result = run([p], [linked]);
    assert.deepEqual(
      result.links[0].explicit.map((r) => r.id),
      ["legacy"],
    );
    assert.equal(result.links[0].candidates.length, 0);
  }
});

test("work and repository deduplication preserve evidence aliases from discarded versions", () => {
  const p = paper("long", {
    doi: "10.1000/shared",
    abstract: "Retinal vessel topology tracing with connectivity reconstruction; a much longer abstract.",
  });
  const alias = paper("short", {
    doi: "10.1000/shared",
    relatedDoi: "10.1000/old",
    abstract: "Code https://github.com/Lab/code",
  });
  const result = run(
    [alias, p],
    [
      repo("old", { url: "https://github.com/lab/other", relatedUrls: ["https://doi.org/10.1000/old"] }),
      repo("latest", { url: "https://github.com/LAB/OTHER/tree/main", observedAt: "2026-11-15T00:00:00Z" }),
      repo("code"),
    ],
  );
  assert.equal(result.stats.papers, 1);
  assert.equal(result.stats.repositories, 2);
  assert.equal(result.links[0].paperId, "long");
  assert.deepEqual(
    result.links[0].explicit.map((r) => r.id),
    ["code", "latest"],
  );
});

test("future, invalid-date, non-core and candidate-only records cannot supply an association", () => {
  const papers = [
    paper("p"),
    paper("future", { publishedAt: "2027-01-01" }),
    paper("bad", { publishedAt: "2026-02-30" }),
    paper("anomaly", { dateAnomaly: "future" }),
    paper("out", { scope: "out" }),
  ];
  const signals = [
    repo("ok"),
    repo("future", { observedAt: "2027-01-01" }),
    repo("created", { publishedAt: "2027-01-01" }),
    repo("bad", { observedAt: "2026-02-30" }),
    repo("candidate", { relevance: { level: "candidate", reasons: ["uncertain"] } }),
    repo("unsafe", { url: "javascript://github.com/lab/x" }),
  ];
  const result = run(papers, signals);
  assert.equal(result.stats.papers, 1);
  assert.equal(result.stats.repositories, 1);
  assert.deepEqual(
    result.links[0].candidates.map((r) => r.id),
    ["ok"],
  );
});

test("both lexical scores rank a specific shared topic above partial overlap", () => {
  const result = run(
    [paper("p")],
    [
      repo("target"),
      repo("partial", { title: "Retinal vessel", summary: "Cardiac chamber ventricular stroke diagnosis." }),
      repo("unrelated", { title: "Kidney cortex", summary: "Renal cyst intensity gradients." }),
    ],
  );
  const row = result.links[0];
  assert.equal(row.explicit.length, 0);
  assert.equal(row.candidates[0].id, "target");
  assert.equal(row.candidates[0].rankTfidf, 1);
  assert.equal(row.candidates[0].rankBm25, 1);
  assert.ok(row.candidates[0].tfidf > 0 && row.candidates[0].tfidf <= 1);
  assert.ok(row.candidates[0].bm25 > 0);
  assert.ok(row.candidates[0].sharedTerms.includes("retinal"));
  assert.ok(!row.candidates.some((r) => r.id === "unrelated"));
  assert.equal(result.stats.candidatePapers, 1);
});

test("zero, URL-only and one-term overlaps abstain rather than invent associations", () => {
  assert.deepEqual(
    codeLinkTokens("Study https://example.org/retinal-vessel 10.1000/tracing 2401.12345v2 <b>paper</b>"),
    [],
  );
  const result = run(
    [
      paper("url", { title: "Study", abstract: "https://example.org/retinal-vessel" }),
      paper("one", { title: "Retinal", abstract: "" }),
      paper("unrelated", { title: "Kidney cortex", abstract: "Renal cyst intensity." }),
    ],
    [repo("candidate")],
  );
  assert.ok(result.links.every((r) => !r.explicit.length && !r.candidates.length));
  assert.equal(result.stats.unmatchedPapers, 3);
});

test("archived repositories are excluded from suggestions while explicit history remains visible", () => {
  const result = run(
    [paper("p"), paper("explicit", { abstract: "Code https://github.com/lab/old" })],
    [repo("old", { archived: true })],
  );
  assert.equal(result.links.find((r) => r.paperId === "p")!.candidates.length, 0);
  assert.equal(result.links.find((r) => r.paperId === "explicit")!.explicit[0].id, "old");
});

test("input reversal preserves representatives, rankings, tie order and source counts", () => {
  const papers = [paper("b"), paper("a"), paper("alias", { doi: "10.1000/a" })];
  const signals = [
    repo("c"),
    repo("b"),
    repo("a"),
    repo("background", { title: "Cardiac chamber", summary: "Ventricular myocardium." }),
    repo("duplicate", { url: "https://github.com/lab/b", observedAt: "2026-10-01T00:00:00Z" }),
  ];
  const expected = run(papers, signals);
  assert.deepEqual(run([...papers].reverse(), [...signals].reverse()), expected);
  assert.deepEqual(
    expected.links[0].candidates.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(
    expected.stats.explicitPapers + expected.stats.candidatePapers + expected.stats.unmatchedPapers,
    expected.stats.papers,
  );
});

test("scoring scratch buffers do not leak similarities from the previous paper", () => {
  const result = run(
    [
      paper("a"),
      paper("b", { title: "Cardiac ventricular chamber", abstract: "Cardiac ventricular chamber tracing." }),
    ],
    [
      repo("retina"),
      repo("heart", { title: "Cardiac ventricular chamber", summary: "Cardiac chamber tracing." }),
    ],
  );
  const heart = result.links.find((r) => r.paperId === "b")!;
  assert.deepEqual(
    heart.candidates.map((r) => r.id),
    ["heart"],
  );
});

test("TF-IDF cosine and BM25 scores agree with an independently calculated small corpus", () => {
  const result = run(
    [paper("p", { title: "Retinal topology", abstract: "" })],
    [
      repo("target", { title: "Retinal topology", summary: "" }),
      repo("partial", { title: "Retinal retinal topology cortex", summary: "" }),
      repo("background", { title: "Cardiac chamber", summary: "" }),
    ],
  );
  const target = result.links[0].candidates.find((r) => r.id === "target")!;
  const partial = result.links[0].candidates.find((r) => r.id === "partial")!;
  assert.ok(Math.abs(target.tfidf - 1) < 1e-12);
  const doubledTf = 1 + Math.log(2);
  const expectedCosine = (doubledTf + 1) / (Math.sqrt(doubledTf ** 2 + 1) * Math.sqrt(2));
  assert.ok(Math.abs(partial.tfidf - expectedCosine) < 1e-12);
  // Three repositories; both query terms appear in two, lengths are 2, 4, 2.
  const repositoryIdf = Math.log(1 + (3 - 2 + 0.5) / (2 + 0.5));
  const averageLength = 8 / 3;
  const targetLengthPenalty = 1.2 * (0.25 + (0.75 * 2) / averageLength);
  const partialLengthPenalty = 1.2 * (0.25 + (0.75 * 4) / averageLength);
  const expectedTargetBm25 = (repositoryIdf * 2 * 2.2) / (1 + targetLengthPenalty);
  const expectedPartialBm25 =
    repositoryIdf * ((2 * 2.2) / (2 + partialLengthPenalty) + 2.2 / (1 + partialLengthPenalty));
  assert.ok(Math.abs(target.bm25 - expectedTargetBm25) < 1e-12);
  assert.ok(Math.abs(partial.bm25 - expectedPartialBm25) < 1e-12);
});

test("empty input is finite and invalid analysis dates fail", () => {
  assert.deepEqual(run([], []).stats, {
    papers: 0,
    repositories: 0,
    explicitPapers: 0,
    candidatePapers: 0,
    unmatchedPapers: 0,
  });
  assert.throws(
    () => analyzePaperCodeLinks({ papers: [], signals: [], asOf: "2026-02-30" }),
    /Invalid association date/,
  );
});

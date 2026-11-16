import test from "node:test";
import assert from "node:assert/strict";
import { analyzeResearch } from "../lib/integrated-analysis";
import type { Paper } from "../lib/types";
import type { ResearchSignal } from "../lib/research-signals";
const date = "2026-11-16";
const paper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id,
  title: "Brain segmentation",
  abstract:
    "We address limited annotations using a U-Net method. We evaluate on brain MRI. Results achieve Dice of 0.9. Dataset available at https://zenodo.org/records/123. Code https://github.com/lab/brain.",
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
const signal = (
  id: string,
  kind: "github" | "news" = "github",
  patch: Record<string, unknown> = {},
): ResearchSignal =>
  ({
    id,
    kind,
    title: "Medical brain segmentation",
    summary: "Brain MRI segmentation with U-Net and limited annotations",
    summaryKind: kind === "github" ? "repository-description" : "publisher-excerpt",
    url: kind === "github" ? `https://github.com/lab/${id}` : `https://news.example/${id}`,
    publisher: "lab",
    publishedAt: kind === "github" ? "2023-01-01T00:00:00Z" : "2026-01-01T00:00:00Z",
    firstSeenAt: "2026-01-01T00:00:00Z",
    observedAt: "2026-11-01T00:00:00Z",
    updatedAt: null,
    topics: [],
    sourceId: "test",
    relatedUrls: [],
    relevance: { level: "direct", reasons: ["test"] },
    ...(kind === "github"
      ? {
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
        }
      : { newsType: "research", discoveryUrl: null, originalUrl: null }),
    ...patch,
  }) as ResearchSignal;
const run = (papers: Paper[] = [], signals: ResearchSignal[] = []) =>
  analyzeResearch({ papers, signals, asOf: date });
const corpus = () => [
  paper("a", { publishedAt: "2023-01-01" }),
  paper("b", { publishedAt: "2024-01-01" }),
  paper("c", { publishedAt: "2025-01-01" }),
  ...Array.from({ length: 40 }, (_, i) =>
    paper(`other-${i}`, { title: "Medical reconstruction", abstract: "MRI reconstruction is evaluated." }),
  ),
];

test("deduplicates versions, repositories and transitive news originals", () => {
  const r = run(
    [paper("a"), paper("b", { doi: "10.1000/a" })],
    [
      signal("one"),
      signal("copy", "github", { url: "https://github.com/LAB/one/tree/main" }),
      signal("n1", "news", { originalUrl: "https://origin.example/article" }),
      signal("n2", "news", { originalUrl: "https://origin.example/article" }),
      signal("n3", "news", { originalUrl: "https://news.example/n2" }),
    ],
  );
  assert.deepEqual(r.totals, { paper: 1, github: 1, news: 1 });
  assert.deepEqual(r.duplicates, { paper: 1, github: 1, news: 2 });
});
test("source volumes do not dominate balanced concentration and tags are not semantic evidence", () => {
  const r = run(
    [paper("a"), paper("b"), paper("c")],
    [
      signal("g"),
      ...Array.from({ length: 100 }, (_, i) =>
        signal(`n${i}`, "news", {
          title: "Medical reconstruction",
          summary: "MRI reconstruction",
          topics: ["segmentation"],
        }),
      ),
    ],
  );
  const d = r.directions.find((d) => d.id === "segmentation")!;
  assert.equal(d.counts.news, 0);
  assert.equal(d.score, 2 / 3);
  assert.equal(d.mainstream, false);
});
test("excludes future, unrelated and candidate-only sources; denominators retain unmatched eligible records", () => {
  const r = run(
    [
      paper("a"),
      paper("future", { publishedAt: "2027-01-01" }),
      paper("outside", { scope: "out" }),
      paper("unknown", { title: "Other medical study", abstract: "Other method" }),
    ],
    [signal("bad", "news", { relevance: { level: "candidate", reasons: ["uncertain"] } })],
  );
  assert.equal(r.totals.paper, 2);
  assert.equal(r.unmatched.paper, 1);
  assert.equal(r.excluded.paper, 2);
  assert.equal(r.totals.news, 0);
  assert.equal(r.directions.find((d) => d.id === "segmentation")!.shares.paper, 0.5);
});
test("niche requires longitudinal works, shared data resource and mature explicitly linked code", () => {
  const r = run(corpus(), [
    signal("brain"),
    signal("linked", "news", { relatedUrls: ["https://doi.org/10.1000/a"] }),
  ]);
  const n = r.niches.find((n) => n.id === "segmentation:labels:brain")!;
  assert.equal(n.ready, true);
  assert.equal(n.evidenceStatus, "sufficient");
  assert.equal(n.count, 3);
  assert.equal(n.logicPapers, 3);
  assert.equal(n.code.length, 1);
  assert.equal(n.news.length, 1);
  assert.ok(n.dataSpanDays >= 730);
});
test("unlinked, young, stale or archived code cannot establish niche accumulation", () => {
  for (const patch of [
    { url: "https://github.com/lab/unrelated" },
    { publishedAt: "2026-01-01T00:00:00Z" },
    { pushedAt: "2024-01-01T00:00:00Z" },
    { archived: true },
  ]) {
    const n = run(corpus(), [signal("brain", "github", patch)]).niches.find(
      (n) => n.id === "segmentation:labels:brain",
    )!;
    assert.equal(n.ready, false);
    assert.equal(n.evidenceStatus, "pending");
    assert.equal(n.code.length, 0);
  }
});
test("negated or newly documented datasets do not establish long data accumulation", () => {
  for (const body of [
    "Dataset is not available at https://zenodo.org/records/123.",
    "We plan to make the dataset available at https://zenodo.org/records/123.",
  ]) {
    const papers = corpus().map((p) => ({
      ...p,
      abstract: p.abstract.replace("Dataset available at https://zenodo.org/records/123.", body),
    }));
    const n = run(papers, [signal("brain")]).niches.find((n) => n.id === "segmentation:labels:brain")!;
    assert.equal(n.ready, false);
    assert.equal(n.data.length, 0);
  }
  const papers = corpus();
  papers[0].abstract = papers[0].abstract.replace("records/123", "records/001");
  papers[1].abstract = papers[1].abstract.replace("records/123", "records/002");
  assert.equal(run(papers, [signal("brain")]).niches[0].ready, false);
});
test("empty data is finite; invalid cutoffs fail; order changes do not change rankings", () => {
  const empty = run();
  assert.ok(empty.directions.every((d) => d.score === 0 && !d.mainstream));
  assert.equal(empty.niches.length, 0);
  assert.throws(() => analyzeResearch({ papers: [], signals: [], asOf: "2026-02-30" }));
  const p = corpus(),
    s = [signal("brain"), signal("n", "news")];
  assert.deepEqual(run(p, s), run([...p].reverse(), [...s].reverse()));
});

test("recent concentration excludes old publications but niche analysis retains their history", () => {
  const r = run(corpus(), [signal("brain"), signal("old", "news", { publishedAt: "2020-01-01T00:00:00Z" })]);
  assert.equal(r.historyTotal, 43);
  assert.equal(r.totals.paper, 40);
  assert.equal(r.totals.github, 1);
  assert.equal(r.totals.news, 0);
  assert.equal(r.niches.find((n) => n.id === "segmentation:labels:brain")!.count, 3);
});
test("negated evaluation cannot satisfy the complete-logic cue gate", () => {
  const p = corpus().map((p) => ({
    ...p,
    abstract: p.abstract.replace("We evaluate on brain MRI.", "We did not evaluate on brain MRI."),
  }));
  const n = run(p, [signal("brain")]).niches.find((n) => n.id === "segmentation:labels:brain")!;
  assert.equal(n.ready, false);
  assert.equal(n.logicPapers, 0);
});

test("missing evidence retains a niche as pending and does not change its observed papers", () => {
  const full = run(corpus(), [signal("brain")]).niches.find((n) => n.id === "segmentation:labels:brain")!;
  const missing = run(corpus(), []).niches.find((n) => n.id === full.id)!;
  assert.equal(full.evidenceStatus, "sufficient");
  assert.equal(missing.evidenceStatus, "pending");
  assert.equal(missing.count, full.count);
  assert.deepEqual(missing.evidence, full.evidence);
  assert.ok(missing.gaps.length > 0);
  assert.ok(run(corpus(), []).niches.every((n) => n.evidenceStatus === (n.ready ? "sufficient" : "pending")));
});

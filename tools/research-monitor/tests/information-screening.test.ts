import test from "node:test";
import assert from "node:assert/strict";
import { screenInformation } from "../lib/information-screening";
import type { PaperScreening } from "../lib/information-screening";
import type { GitHubSignal, NewsSignal, ResearchSignal } from "../lib/research-signals";
import type { Paper } from "../lib/types";

const paper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id,
  title: "Adaptive retinal vessel segmentation",
  abstract: "We investigate vessel segmentation. We propose an adaptive algorithm.",
  authors: [{ name: "Ada Smith", affiliations: [] }],
  affiliations: [],
  doi: null,
  source: "Europe PMC",
  sources: ["Europe PMC"],
  status: "published",
  publishedAt: "2026-09-01",
  updatedAt: null,
  firstSeenAt: "2026-10-02T00:00:00Z",
  venue: null,
  url: `https://example.org/papers/${id}`,
  tasks: ["segmentation"],
  modalities: ["fundus"],
  organs: ["retina"],
  methods: [],
  humanSignals: [],
  evidence: [],
  tracks: [],
  reviewStatus: "unreviewed",
  provenance: [],
  ...patch,
});
const news = (id: string, patch: Partial<NewsSignal> = {}): NewsSignal => ({
  id,
  kind: "news",
  title: "Retinal model announcement",
  url: `https://news.example.org/${id}`,
  summary: "A publisher announcement",
  summaryKind: "publisher-excerpt",
  publisher: "Example",
  publishedAt: "2026-09-10T00:00:00Z",
  firstSeenAt: "2026-10-01T00:00:00Z",
  observedAt: "2026-10-02T00:00:00Z",
  updatedAt: null,
  topics: [],
  sourceId: "news",
  relatedUrls: [],
  newsType: "research",
  discoveryUrl: null,
  originalUrl: null,
  ...patch,
});
const github = (id: string, patch: Partial<GitHubSignal> = {}): GitHubSignal => ({
  id,
  kind: "github",
  title: `lab/${id}`,
  fullName: `lab/${id}`,
  url: `https://github.com/lab/${id}`,
  summary: "Retinal code",
  summaryKind: "repository-description",
  publisher: "lab",
  publishedAt: "2026-09-10T00:00:00Z",
  firstSeenAt: "2026-10-01T00:00:00Z",
  observedAt: "2026-10-02T00:00:00Z",
  updatedAt: null,
  topics: [],
  sourceId: "github",
  relatedUrls: [],
  stars: 1,
  forks: 0,
  openIssues: 0,
  license: null,
  language: null,
  archived: false,
  pushedAt: null,
  releasedAt: null,
  releaseUrl: null,
  readmeExcerpt: "",
  ...patch,
});
function screen(
  papers: Paper[],
  candidateIds = papers.map((p) => p.id),
  signals: ResearchSignal[] = [],
  patch: Partial<Parameters<typeof screenInformation>[0]> = {},
): PaperScreening[] {
  return screenInformation({
    papers,
    candidateIds,
    signals,
    loaded: { github: true, news: true },
    since: "2026-10-01",
    asOf: "2026-10-14",
    ...patch,
  });
}
const english = (findings: { message: { en: string } }[]) => findings.map((f) => f.message.en).join(" ");

test("dates require explicit valid calendar days and an ordered inclusive window", () => {
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    "2026-10-14T00:00:00Z",
    "invalid",
  ]) {
    assert.throws(
      () => screen([], [], [], { since: value }),
      /since must be a valid calendar date.*YYYY-MM-DD/,
    );
    assert.throws(
      () => screen([], [], [], { asOf: value }),
      /asOf must be a valid calendar date.*YYYY-MM-DD/,
    );
  }
  assert.throws(() => screen([], [], [], { since: "2026-10-15" }), /since must be on or before asOf/);
  assert.deepEqual(screen([], [], [], { since: "2024-02-29", asOf: "2024-02-29" }), []);
});

test("same title and same authors with distinct identifiers are not merged", () => {
  const a = paper("a", { doi: "10.1000/a" });
  const b = paper("b", { doi: "10.1000/b", firstSeenAt: "2026-08-01T00:00:00Z" });
  const [result] = screen([a, b], ["a"]);
  assert.equal(result.history.state, "new");
  assert.deepEqual(result.history.references, []);
});

test("actual work identifiers connect DOI duplicates, arXiv versions and explicit publication versions", () => {
  const records = [
    paper("a", { doi: "10.1000/Published" }),
    paper("b", { doi: "https://doi.org/10.1000/published" }),
    paper("arxiv:2601.12345v1", { arxivId: "2601.12345v1", relatedDoi: "10.1000/published" }),
    paper("arxiv:2601.12345v2", { arxivId: "2601.12345v2" }),
  ];
  const [result] = screen(records, ["a"]);
  assert.equal(result.history.state, "related-version");
  assert.deepEqual(
    result.history.references.map((r) => r.id),
    ["arxiv:2601.12345v1", "arxiv:2601.12345v2", "b"],
  );
  assert.match(english(result.history.findings), /possibly duplicates or versions/);
  assert.match(english(result.history.findings), /no old snapshots.*version diffs/);
});

test("primary DOI/arXiv URLs can connect identity but abstract citations and shared GitHub never do", () => {
  const target = paper("a", {
    doi: "10.1000/target",
    abstract: "Code https://github.com/lab/shared. Prior work https://doi.org/10.1000/prior.",
  });
  const urlCopy = paper("b", { url: "https://doi.org/10.1000/target" });
  const cited = paper("c", { doi: "10.1000/prior", abstract: "Code https://github.com/lab/shared." });
  const [result] = screen([target, urlCopy, cited], ["a"]);
  assert.deepEqual(
    result.history.references.map((r) => r.id),
    ["b"],
  );
  const [shared] = screen(
    [
      paper("repo-a", { url: "https://github.com/lab/shared" }),
      paper("repo-b", { url: "https://github.com/lab/shared" }),
    ],
    ["repo-a"],
  );
  assert.deepEqual(shared.history.references, []);
});

test("firstSeenAt and earliest collection provenance describe discovery, never publication or novelty", () => {
  const [fresh] = screen([paper("old-publication", { publishedAt: "2015-01-01" })]);
  assert.equal(fresh.history.state, "new");
  assert.match(english(fresh.history.findings), /First collection is not publication/);
  assert.match(english(fresh.history.findings), /does not establish scientific novelty/);
  const [known] = screen([paper("known", { provenance: [{ collectedAt: "2026-07-01T00:00:00Z" }] })]);
  assert.equal(known.history.state, "known");
  assert.match(english(known.history.findings), /2026-07-01/);
  const [unknown] = screen([paper("unknown", { firstSeenAt: "" })]);
  assert.equal(unknown.history.state, "unknown");
  const [boundary] = screen([paper("boundary", { firstSeenAt: "2026-10-01T00:00:00Z" })]);
  assert.equal(boundary.history.state, "new");
});

test("candidate records after cutoff are not screened using future current text", () => {
  const patches: Partial<Paper>[] = [
    { publishedAt: "2026-10-15" },
    { updatedAt: "2026-10-15T00:00:00Z" },
    { firstSeenAt: "2026-10-15T00:00:00Z" },
    { provenance: [{ collectedAt: "2026-10-15T00:00:00Z" }] },
    { publishedAt: "2026-02-30" },
    { dateAnomaly: "future" },
  ];
  for (const patch of patches) {
    const [result] = screen([paper("future", { abstract: "We outperform all methods.", ...patch })]);
    assert.equal(result.history.state, "unknown");
    assert.equal(result.crossSource.state, "incomplete");
    assert.equal(result.logic.state, "insufficient");
    assert.deepEqual(result.priorWork.references, []);
    assert.ok(!result.logic.findings.some((f) => f.id === "superiority-review"));
  }
});

test("cross-source links require explicit identifiers or URLs, not topical similarity", () => {
  const p = paper("target", { doi: "10.1000/target" });
  const [result] = screen(
    [p],
    [p.id],
    [news("topic-only"), github("linked", { relatedUrls: ["https://doi.org/10.1000/target"] })],
  );
  assert.equal(result.crossSource.state, "linked");
  assert.deepEqual(
    result.crossSource.references.map((r) => r.id),
    ["linked"],
  );
  assert.match(result.crossSource.references[0].basis.en, /doi:10.1000\/target/);
  assert.match(english(result.crossSource.findings), /not independent scientific validation/);
});

test("citation-only DOI links are associations to possibly cited work, not work identity", () => {
  const p = paper("target", { abstract: "We compare with prior work https://doi.org/10.1000/prior." });
  const [result] = screen(
    [p, paper("cited", { doi: "10.1000/prior" })],
    [p.id],
    [news("coverage", { relatedUrls: ["https://doi.org/10.1000/prior"] })],
  );
  assert.equal(result.history.references.length, 0);
  assert.equal(result.crossSource.references.length, 1);
  assert.match(result.crossSource.references[0].basis.en, /abstract citation\/link only.*cited work/);
});

test("URL and news originalUrl repost deduplication is transitive and preserves association evidence", () => {
  const p = paper("target", { doi: "10.1000/target" });
  const relatedUrls = ["https://doi.org/10.1000/target"];
  const records = [
    news("a-original", { url: "https://publisher.example.org/story", relatedUrls: [] }),
    news("b-repost", {
      url: "https://aggregator.example.org/copy",
      originalUrl: "https://publisher.example.org/story?utm_source=rss#top",
      relatedUrls,
    }),
    news("c-route", {
      url: "https://aggregator.example.org/copy/",
      originalUrl: "https://other.example.org/repost",
      relatedUrls,
    }),
    news("d-distinct", { url: "https://publisher.example.org/another-story", relatedUrls }),
  ];
  const [result] = screen([p], [p.id], records);
  assert.equal(result.crossSource.references.length, 2);
  assert.deepEqual(
    result.crossSource.references.map((r) => r.id),
    ["a-original", "d-distinct"],
  );
  assert.match(result.crossSource.references[0].basis.en, /Collapsed 3 records/);
});

test("missing source loading remains incomplete with and without known links", () => {
  const p = paper("target");
  for (const signals of [[], [news("linked", { relatedUrls: [p.url] })]]) {
    const [result] = screen([p], [p.id], signals, { loaded: { github: false, news: true } });
    assert.equal(result.crossSource.state, "incomplete");
    assert.match(english(result.crossSource.findings), /Sources not fully loaded: GitHub/);
    assert.equal(result.crossSource.references.length, signals.length);
  }
  assert.equal(screen([p])[0].crossSource.state, "none");
});

test("future or invalid observed/first-seen/publication/revision/release records are excluded", () => {
  const p = paper("target");
  const future = "2026-10-15T00:00:00Z";
  const records: ResearchSignal[] = [
    news("observed", { observedAt: future }),
    news("seen", { firstSeenAt: future }),
    news("published", { publishedAt: future }),
    news("updated", { updatedAt: future }),
    news("invalid", { observedAt: "2026-02-30T00:00:00Z" }),
    github("pushed", { pushedAt: future }),
    github("released", { releasedAt: future }),
    news("last-instant", { observedAt: "2026-10-14T23:59:59Z" }),
    news("offset-future", { observedAt: "2026-10-14T23:59:59-02:00" }),
  ];
  const [result] = screen(
    [p],
    [p.id],
    records.map((r) => ({ ...r, relatedUrls: [p.url] })),
  );
  assert.deepEqual(
    result.crossSource.references.map((r) => r.id),
    ["last-instant"],
  );
  assert.match(english(result.crossSource.findings), /8 source record\(s\) excluded/);
});

test("prior work searches the complete corpus and explains earlier date, rare title terms and labels", () => {
  const target = paper("target");
  const earlier = paper("older", { publishedAt: "2026-01-01", updatedAt: "2026-08-31T00:00:00Z" });
  const [result] = screen([target, earlier], [target.id]);
  assert.equal(result.priorWork.state, "candidates");
  assert.deepEqual(
    result.priorWork.references.map((r) => r.id),
    ["older"],
  );
  assert.match(
    result.priorWork.references[0].basis.en,
    /2026-01-01, before 2026-09-01.*rare title terms:.*retinal.*shared tasks: segmentation.*shared modalities: fundus/,
  );
  assert.match(english(result.priorWork.findings), /not a systematic review/);
  // Publication chronology must not be replaced by when the collector found the paper.
  assert.equal(earlier.firstSeenAt, target.firstSeenAt);
});

test("prior work excludes same-work versions, same/later publication, late revisions and future observations", () => {
  const target = paper("target", { doi: "10.1000/target" });
  const older = { publishedAt: "2026-01-01" };
  const records = [
    target,
    paper("duplicate", { ...older, doi: "10.1000/target" }),
    paper("same-day"),
    paper("later", { publishedAt: "2026-09-02" }),
    paper("revised-later", { ...older, updatedAt: "2026-09-02T00:00:00Z" }),
    paper("future-seen", { ...older, firstSeenAt: "2026-10-15T00:00:00Z" }),
    paper("allowed-boundary", { ...older, updatedAt: "2026-09-01T23:59:59Z" }),
    paper("missing-date", { publishedAt: "" }),
  ];
  const [result] = screen(records, ["target"]);
  assert.deepEqual(
    result.priorWork.references.map((r) => r.id),
    ["allowed-boundary"],
  );
});

test("prior retrieval requires title and task/modality evidence, deduplicates works and caps at five", () => {
  const target = paper("target");
  const records = [
    target,
    paper("unrelated-labels", { publishedAt: "2026-01-01", tasks: ["registration"], modalities: ["CT"] }),
    paper("unrelated-title", { publishedAt: "2026-01-01", title: "Pulmonary nodule detection" }),
    ...Array.from({ length: 6 }, (_, i) =>
      paper(`old-${i}`, { publishedAt: `2026-0${i + 1}-01`, doi: `10.1000/old-${i}` }),
    ),
    paper("copy", { publishedAt: "2026-06-01", doi: "10.1000/old-5" }),
  ];
  const [result] = screen(records, ["target"]);
  assert.equal(result.priorWork.references.length, 5);
  assert.ok(result.priorWork.references.every((r) => !r.id.startsWith("unrelated")));
  assert.ok(
    !(
      result.priorWork.references.some((r) => r.id === "copy") &&
      result.priorWork.references.some((r) => r.id === "old-5")
    ),
  );
});

test("common title postings are bounded and no match is not a novelty verdict", () => {
  const records = Array.from({ length: 300 }, (_, i) => paper(`common-${i}`, { publishedAt: "2026-01-01" }));
  const target = paper("target");
  const [result] = screen([target, ...records], ["target"]);
  assert.equal(result.priorWork.state, "none");
  assert.match(english(result.priorWork.findings), /no matches does not establish novelty/);
  assert.match(english(result.priorWork.findings), /common title terms/);
});

test("a missing publication date never falls back to firstSeenAt for prior-work chronology", () => {
  const target = paper("target", { publishedAt: "" });
  const [result] = screen([target, paper("old", { publishedAt: "2025-01-01" })], [target.id]);
  assert.equal(result.priorWork.state, "none");
  assert.match(english(result.priorWork.findings), /first collection was not substituted/);
});

test("missing abstracts are insufficient and conceptual papers are not penalized for no experiments", () => {
  const [missing] = screen([paper("missing", { abstract: "  " })]);
  assert.equal(missing.logic.state, "insufficient");
  assert.ok(missing.logic.findings.some((f) => f.id === "abstract-missing"));
  const abstract = "We propose a conceptual framework and prove a theorem addressing identifiability.";
  const [conceptual] = screen([paper("conceptual", { abstract })]);
  assert.equal(conceptual.logic.state, "cues-found");
  assert.ok(!conceptual.logic.findings.some((f) => f.status === "review"));
  assert.equal(conceptual.logic.findings.find((f) => f.id === "logic-method")?.excerpt, abstract);
  assert.equal(conceptual.logic.findings.find((f) => f.id === "logic-experiment")?.status, "unknown");
  assert.match(english(conceptual.logic.findings), /does not mean absent from the full text/);
});

test("affirmative superiority without comparator or quantitative cues requests review, never a truth verdict", () => {
  const abstract = "Our method outperforms existing systems.";
  const [result] = screen([paper("claim", { abstract })]);
  assert.equal(result.logic.state, "review");
  const review = result.logic.findings.find((f) => f.id === "superiority-review")!;
  assert.equal(review.excerpt, abstract);
  assert.match(review.message.en, /comparator\/baseline.*quantitative.*not a falsehood or quality verdict/);
  const [supported] = screen([
    paper("supported", {
      abstract: "Our method outperforms the baseline with Dice of 0.92 compared with 0.85.",
    }),
  ]);
  assert.equal(supported.logic.state, "cues-found");
  assert.ok(!supported.logic.findings.some((f) => f.id === "superiority-review"));
  const [sampleCount] = screen([
    paper("count", { abstract: "Our model outperforms the baseline in 400 patients." }),
  ]);
  assert.equal(
    sampleCount.logic.state,
    "review",
    "sample count alone is not a quantitative performance result",
  );
});

test("negation, hypothetical and attributed superiority are not affirmative superiority claims", () => {
  const examples = [
    "Our method does not outperform existing methods.",
    "We found no evidence of superiority.",
    "The model failed to outperform existing methods.",
    "Our method may outperform existing methods.",
    "We investigate whether our model is superior.",
    "Previous studies reported superior performance.",
    "本方法并未优于现有方法。",
    "我们探讨是否优于既有方法。",
  ];
  for (const abstract of examples) {
    const [result] = screen([paper("negated", { abstract })]);
    assert.notEqual(result.logic.state, "review", abstract);
    assert.ok(!result.logic.findings.some((f) => f.id === "superiority-review"), abstract);
    for (const f of result.logic.findings) if (f.excerpt) assert.ok(abstract.includes(f.excerpt));
  }
  const [independent] = screen([
    paper("two-sentences", { abstract: "We do not use labels. Our method outperforms all competitors." }),
  ]);
  assert.equal(
    independent.logic.state,
    "review",
    "negation in a separate sentence must not hide a positive claim",
  );
});

test("observational wording is preserved without inferring causal or clinical validation", () => {
  const abstract = "A retrospective cohort showed an association between predictions and survival.";
  const [result] = screen([paper("observational", { abstract })]);
  const cue = result.logic.findings.find((f) => f.id === "observational-scope")!;
  assert.equal(cue.excerpt, abstract);
  assert.match(cue.message.en, /does not establish causality or clinical effectiveness/);
  assert.notEqual(result.logic.state, "review");
});

test("original abstract is preferred and both languages are present on all public findings/references", () => {
  const originalAbstract = "We propose a theoretical framework.";
  const [result] = screen([
    paper("original", { originalAbstract, abstract: "Our model outperforms all systems." }),
  ]);
  assert.equal(result.logic.state, "cues-found");
  assert.equal(result.logic.findings.find((f) => f.id === "logic-method")?.excerpt, originalAbstract);
  for (const section of [result.history, result.crossSource, result.priorWork, result.logic])
    for (const f of section.findings) {
      assert.ok(f.message.zh.length);
      assert.ok(f.message.en.length);
    }
});

test("output ordering is deterministic across shuffled inputs and inputs are not mutated", () => {
  const records = [
    paper("z"),
    paper("a", { publishedAt: "2026-01-01", doi: "10.1000/a" }),
    paper("b", { doi: "10.1000/a" }),
  ];
  const signals = [
    news("z-link", { relatedUrls: [records[0].url] }),
    news("a-link", { relatedUrls: [records[0].url] }),
  ];
  const before = structuredClone({ records, signals });
  const actual = screen(records, ["z", "a", "z", "missing"], signals);
  const reordered = screen([...records].reverse(), ["missing", "a", "z"], [...signals].reverse());
  assert.deepEqual(actual, reordered);
  assert.deepEqual(
    actual.map((r) => r.paperId),
    ["a", "missing", "z"],
  );
  assert.equal(actual[1].history.state, "unknown");
  assert.deepEqual({ records, signals }, before);
});

test("paraphrased stages do not trigger a review based on lexical overlap", () => {
  const [result] = screen([
    paper("paraphrase", {
      abstract:
        "We investigate tumor delineation. We propose a boundary extraction algorithm. We evaluate on held-out scans. Results show Dice of 0.91.",
    }),
  ]);
  assert.equal(result.logic.state, "cues-found");
  const chain = result.logic.findings.filter((f) => f.comparison);
  assert.equal(chain.length, 3);
  assert.ok(chain.every((f) => f.status === "observed"));
  assert.deepEqual(
    chain[0].comparison!.map((side) => side.excerpts),
    [["We investigate tumor delineation."], ["We propose a boundary extraction algorithm."]],
  );
  assert.ok(chain.every((f) => !/[\p{Script=Han}]/u.test(f.message.en)));
});

test("missing stages and shared sentences remain unknown, including conceptual work", () => {
  const [result] = screen([
    paper("concept", { abstract: "We propose a theoretical framework to address identifiability." }),
  ]);
  assert.equal(result.logic.state, "cues-found");
  const chain = result.logic.findings.filter((f) => f.comparison);
  assert.ok(chain.every((f) => f.status === "unknown"));
  assert.match(chain[0].message.en, /same sentence/);
  assert.equal(chain[1].comparison![1].count, 0);
});

test("background figures and prevalence percentages cannot support an unrelated superiority claim", () => {
  for (const abstract of [
    "Previous work compared baselines with Dice of 0.92. Our algorithm outperforms all systems.",
    "Our model outperforms the baseline in a cohort with 90% female patients.",
    "Our model outperforms the baseline. Prior work achieved Dice of 0.92.",
  ]) {
    const [result] = screen([paper("unsupported", { abstract })]);
    assert.equal(result.logic.state, "review", abstract);
    assert.ok(result.logic.findings.some((f) => f.id === "superiority-review"));
  }
});

test("each affirmative claim requires its own local evidence", () => {
  const [result] = screen([
    paper("multiple", {
      abstract:
        "Our model outperforms the baseline with Dice of 0.92 compared with 0.85. Our classifier surpasses all systems.",
    }),
  ]);
  assert.equal(result.logic.state, "review");
  const findings = result.logic.findings.filter((f) => f.status === "review");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].excerpt, "Our classifier surpasses all systems.");
});

test("an explicitly linked following result can supply local evidence in both languages", () => {
  for (const abstract of [
    "Our model outperforms the baseline. Specifically, Dice of 0.92 was achieved.",
    "我们提出的方法优于基线。具体而言，准确率为92%。",
  ]) {
    const [result] = screen([paper("linked", { abstract })]);
    assert.equal(result.logic.state, "cues-found", abstract);
  }
});

test("paired excerpts are bounded and retain negation and full matching counts", () => {
  const [result] = screen([
    paper("bounded", {
      abstract:
        "We aim to identify lesions. We propose one algorithm. We develop another algorithm. We introduce a framework. We propose a fourth method. We do not evaluate on external patients.",
    }),
  ]);
  const chain = result.logic.findings.find((f) => f.id === "chain-method-experiment")!;
  assert.equal(chain.comparison![0].count, 4);
  assert.equal(chain.comparison![0].excerpts.length, 3);
  assert.deepEqual(chain.comparison![1].excerpts, ["We do not evaluate on external patients."]);
});

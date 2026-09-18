import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperAnalysis, buildPreliminaryAnalysis } from "../lib/analysis";
import type { DashboardFilters } from "../lib/dashboard";
import type { MonitorData, Paper, Team } from "../lib/types";

const now = new Date("2026-09-18T04:00:00Z");
const filters: DashboardFilters = {days: "30", clock: "publication", track: "all", source: "all"};
const author = (name: string, orcid?: string) => ({name, orcid, affiliations: ["Example Hospital"]});
function paper(id: string, patch: Partial<Paper> = {}): Paper {
  return {id, title: "Medical imaging research", abstract: "", authors: [], affiliations: [], doi: null, source: "Europe PMC", sources: ["Europe PMC"], status: "published", publishedAt: "2026-09-18", updatedAt: null, firstSeenAt: "2026-09-18T01:00:00Z", venue: null, url: "https://example.org/paper", tasks: [], modalities: [], organs: [], methods: [], humanSignals: [], evidence: [], tracks: [], reviewStatus: "unreviewed", provenance: [], ...patch};
}
function data(papers: Paper[]): MonitorData {return {papers, runs: [], queryRuns: [], collectedAt: now.toISOString(), storageAvailable: true, lastSuccessfulSync: null, coverage: "sample"};}

test("deduplicates paper IDs and counts multilabel combinations against the direction denominator", () => {
  const one = paper("one", {tracks: ["segmentation", "segmentation", "foundation"], methods: ["基础模型", "基础模型"], organs: ["脑 / 神经", "脑 / 神经"], modalities: ["MRI"]});
  const two = paper("two", {tracks: ["segmentation"], methods: ["自监督"], modalities: ["MRI"]});
  const result = buildPreliminaryAnalysis(data([one, one, two]), filters, [], now);
  assert.equal(result.scope.total, 2);
  assert.equal(result.scope.duplicatesRemoved, 1);
  assert.equal(result.directions.find(row => row.id === "segmentation")?.count, 2);
  assert.equal(result.directions.find(row => row.id === "foundation")?.share, 50);
  const combo = result.combinations.find(row => row.id === "segmentation:基础模型")!;
  assert.deepEqual([combo.count, combo.denominator, combo.share], [1, 2, 50]);
  assert.deepEqual(combo.paperIds, ["one"]);
  assert.equal(result.topics.find(row => row.kind === "organ")?.count, 1);
  assert.equal(result.topics.find(row => row.kind === "modality")?.share, 100);
});

test("publication date, source, and direction filters form one shared scope", () => {
  const base = {tracks: ["segmentation"], methods: ["自监督"], abstract: "We externally validated our MRI model in an external cohort."};
  const selected = paper("selected", {...base, publishedAt: "2026-08-20", firstSeenAt: "2020-01-01"});
  const result = buildPreliminaryAnalysis(data([
    selected,
    paper("old", {...base, publishedAt: "2026-08-19"}),
    paper("future", {...base, publishedAt: "2026-09-19"}),
    paper("invalid", {...base, publishedAt: "2026-02-30"}),
    paper("malformed", {...base, publishedAt: "no date"}),
    paper("source", {...base, sources: ["arXiv"]}),
    paper("track", {...base, tracks: ["prognosis"]}),
  ]), {...filters, clock: "discovery", track: "segmentation", source: "Europe PMC"}, [], now);
  assert.deepEqual(result.scope.rows.map(row => row.id), ["selected"]);
  assert.equal(result.scope.clock, "publication");
  assert.equal(result.scope.from, "2026-08-20");
  assert.equal(result.scope.to, "2026-09-18");
  assert.equal(result.scope.excludedFuture, 1);
  assert.equal(result.scope.excludedInvalidDate, 2);
  assert.deepEqual(Object.keys(result.paperAnalyses), ["selected"]);
  assert.deepEqual(result.signals.find(row => row.id === "external_validation")?.paperIds, ["selected"]);
  assert.deepEqual(result.readingCandidates.map(row => row.paper.id), ["selected"]);
});

test("omits the definitionally identical foundation direction and foundation method pair", () => {
  const result = buildPreliminaryAnalysis(data([paper("one", {tracks: ["foundation"], methods: ["基础模型", "自监督"], abstract: "We developed a foundation model."})]), filters, [], now);
  assert.equal(result.combinations.some(row => row.id === "foundation:基础模型"), false);
  assert.equal(result.combinations.find(row => row.id === "foundation:自监督")?.count, 1);
  assert.equal(result.readingCandidates[0].reasons[0].method, "自监督");
});

test("extracts only original abstract sentences and affirmative study signals", () => {
  const abstract = "OBJECTIVE: We aimed to improve brain MRI segmentation. METHODS: We conducted a prospective multicentre study and externally validated the model on an external cohort. Three radiologists evaluated the predictions in a reader study. RESULTS: The method achieved a Dice score of 0.91. Our code is publicly available at https://github.com/example/model. The dataset is publicly available at https://example.org/data.";
  const result = buildPaperAnalysis(paper("one", {abstract: "Changed display text", originalAbstract: abstract}));
  assert.ok(result.objective?.startsWith("OBJECTIVE:"));
  assert.ok(result.methods?.startsWith("METHODS:"));
  assert.equal(result.results, "RESULTS: The method achieved a Dice score of 0.91.");
  assert.equal(result.signals.length, 6);
  for (const signal of result.signals) assert.ok(abstract.includes(signal.excerpt));
});

test("prefers explicit study aims and Materials & Methods over mislabeling an objective as methods", () => {
  const abstract = "Objectives: Brain imaging is challenging across hospitals. This study aimed to develop and externally test a segmentation framework. Materials & Methods: In this retrospective multicenter study, a model was trained on 801 CT scans. Results: Median Dice was 0.68.";
  const result = buildPaperAnalysis(paper("structured", {abstract}));
  assert.equal(result.objective, "This study aimed to develop and externally test a segmentation framework.");
  assert.equal(result.methods, "Materials & Methods: In this retrospective multicenter study, a model was trained on 801 CT scans.");
  assert.equal(result.results, "Results: Median Dice was 0.68.");
  const planned = buildPaperAnalysis(paper("objective-only", {abstract: "This study aimed to develop a segmentation model."}));
  assert.equal(planned.methods, null);
  const spelling = buildPaperAnalysis(paper("and", {abstract: "Materials and Methods: We trained a network on MRI scans."}));
  assert.equal(spelling.methods, "Materials and Methods: We trained a network on MRI scans.");
});

test("does not turn negation, future plans, background, annotations, or restricted sharing into evidence", () => {
  const abstracts = [
    "No external validation was performed. The study was not multicentre and was not prospective. No clinician evaluation or reader study was conducted. Code is not available. Data are not available.",
    "We will conduct prospective external validation in a multicentre reader study. Our code and data will be available after publication.",
    "BACKGROUND: External validation and prospective multicentre reader studies are important. Prior studies showed that external validation improved accuracy. Existing studies provide code and data that are publicly available.",
    "Experts annotated the training images. Code and data are available upon reasonable request.",
    "We used code that is publicly available from a prior benchmark. Our code is unavailable.",
    "We describe a multicentre trial protocol for a prospective reader study with external validation.",
    "This study aimed to externally test a segmentation model. External and multicentre validation remained limited. Children were prospectively associated with carotid thickness.",
    "Supplementary data are available online. We release all checkpoints, optimizer states, data-split indices, and starter code.",
  ];
  for (const abstract of abstracts) assert.deepEqual(buildPaperAnalysis(paper("one", {abstract})).signals, [], abstract);
  assert.deepEqual(buildPaperAnalysis(paper("review", {title: "A narrative review of medical imaging", abstract: "Representative studies were selected that included external validation and prospective design."})).signals, []);
  const implicitReview = buildPaperAnalysis(paper("abstract-review", {
    title: "Artificial intelligence in otolaryngology: current applications, limitations, and future perspectives.",
    abstract: "Methods This narrative review summarizes artificial intelligence applications. Several multicentre studies evaluated prospective cohorts. A prospective study found improved diagnostic accuracy. Our code is publicly available at https://example.org/code.",
  }));
  assert.deepEqual(implicitReview.signals.map(signal => signal.id), ["code_availability"]);
});

test("signal shares use the number with abstracts and keep missing abstracts unknown", () => {
  const result = buildPreliminaryAnalysis(data([
    paper("positive", {abstract: "We conducted external validation on a separate cohort."}),
    paper("unmentioned", {abstract: "We developed a segmentation method."}),
    paper("unknown"),
  ]), filters, [], now);
  assert.equal(result.scope.total, 3);
  assert.equal(result.scope.withAbstractCount, 2);
  const signal = result.signals.find(row => row.id === "external_validation")!;
  assert.deepEqual([signal.count, signal.denominator, signal.share], [1, 2, 50]);
});

test("missing abstracts produce no invented summary or signals; generic text is not a result", () => {
  assert.deepEqual(buildPaperAnalysis(paper("empty")), {paperId: "empty", hasAbstract: false, objective: null, methods: null, results: null, signals: []});
  const result = buildPaperAnalysis(paper("generic", {abstract: "Medical imaging is increasingly useful in clinical practice."}));
  assert.equal(result.hasAbstract, true);
  assert.equal(result.results, null);
  assert.equal(result.methods, null);
});

test("author counts prefer ORCID, deduplicate authors per paper, and mark name-only identities uncertain", () => {
  const first = paper("one", {authors: [author("Alice A", "https://orcid.org/0000-0001-2345-6789"), author("A. A.", "0000-0001-2345-6789"), author("Bob B"), author("Bob B")]});
  const second = paper("two", {authors: [author("Alice Different Display", "0000-0001-2345-6789"), author("Bob B")]});
  const result = buildPreliminaryAnalysis(data([first, second]), filters, [], now);
  assert.equal(result.authorsTop.length, 2);
  const alice = result.authorsTop.find(row => row.orcid)!;
  assert.equal(alice.count, 2);
  assert.equal(alice.identityUncertain, false);
  assert.equal(result.authorsTop.find(row => !row.orcid)?.identityUncertain, true);
  assert.equal(result.coauthorPairs.length, 1);
  assert.equal(result.coauthorPairs[0].count, 2);
});

test("large author lists are excluded from coauthor pairs and watchlists obey the same filtered papers", () => {
  const team: Team = {id: "t", name: "Team", members: ["Person 0"], institution: "Example Hospital", kind: "collaborator", createdAt: now.toISOString()};
  const large = paper("large", {authors: Array.from({length: 41}, (_, i) => author(`Person ${i}`))});
  const old = paper("old", {authors: [author("Person 0")], publishedAt: "2020-01-01"});
  const result = buildPreliminaryAnalysis(data([large, old]), filters, [team], now);
  assert.equal(result.coauthorExcludedLargePapers, 1);
  assert.deepEqual(result.coauthorPairs, []);
  assert.deepEqual(result.watchlistMatches[0].paperIds, ["large"]);
  assert.equal(result.watchlistMatches[0].count, 1);
});

test("reading candidates are unique, limited to six, and expose transparent reasons", () => {
  const papers = Array.from({length: 10}, (_, i) => paper(String(i), {publishedAt: `2026-09-${String(18 - i).padStart(2, "0")}`, tracks: [i % 2 ? "segmentation" : "foundation"], methods: [i % 2 ? "自监督" : "基础模型"], abstract: "We developed a medical image model. The method achieved a Dice score of 0.85."}));
  const result = buildPreliminaryAnalysis(data(papers), filters, [], now);
  assert.equal(result.readingCandidates.length, 6);
  assert.equal(new Set(result.readingCandidates.map(row => row.paper.id)).size, 6);
  assert.ok(result.readingCandidates.every(row => row.reasons.length > 0 && row.reasons.length <= 3));
  assert.ok(result.readingCandidates.every(row => result.scope.rows.includes(row.paper)));
  assert.equal(result.readingCandidates[0].reasons[0].kind, "combination");
});

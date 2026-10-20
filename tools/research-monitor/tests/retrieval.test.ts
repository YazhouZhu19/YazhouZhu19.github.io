import test from "node:test";
import assert from "node:assert/strict";
import { expandedQuery, retrieve, retrievalTokens } from "../lib/retrieval";
import { prepareAiEvidence, selectAiEvidence, type AiSpec } from "../lib/ai-evidence";
import type { Paper } from "../lib/types";
const spec: AiSpec = {
  mode: "interest",
  from: "2026-01-01",
  to: "2026-10-01",
  question: "甲状腺超声分割的最新方法",
  horizonMonths: 6,
  locale: "zh",
};
const now = new Date("2026-10-21T00:00:00Z");
const row = (id: string, title: string): Paper => ({
  id,
  title,
  abstract: title,
  authors: [],
  affiliations: [],
  doi: null,
  source: "Test",
  sources: ["Test"],
  status: "published",
  publishedAt: "2026-09-01",
  updatedAt: null,
  firstSeenAt: "2026-09-01T00:00:00Z",
  venue: null,
  url: `https://example.org/${id}`,
  tasks: [],
  tracks: [],
  methods: [],
  modalities: [],
  organs: [],
  humanSignals: [],
  evidence: [],
  reviewStatus: "unreviewed",
  provenance: [],
});
test("Chinese thyroid ultrasound question retrieves all five relevant works among fifty", () => {
  const papers = Array.from({ length: 50 }, (_, i) =>
    row(
      `p${i}`,
      i < 5
        ? `Thyroid ultrasound nodule segmentation experiment ${i}`
        : `Cardiac MRI reconstruction experiment ${i}`,
    ),
  );
  const result = prepareAiEvidence(papers, spec, 6, now);
  assert.deepEqual(new Set(result.papers.map((p) => p.id)), new Set(["p0", "p1", "p2", "p3", "p4"]));
  assert.equal(result.totalWorks, 50);
  assert.equal(result.retrieval?.candidates, 5);
  assert.ok(result.retrieval?.expandedTerms.includes("thyroid"));
  assert.equal(prepareAiEvidence([...papers].reverse(), spec, 6, now).key, result.key);
});
test("no match remains empty in interest and question-bearing team modes", () => {
  for (const mode of ["interest", "team"] as const) {
    const result = prepareAiEvidence(
      [row("a", "Cardiac MRI")],
      { ...spec, mode, question: "volcanic geology" },
      6,
      now,
    );
    assert.equal(result.papers.length, 0);
    assert.equal(result.totalWorks, 1);
    assert.equal(result.retrieval?.candidates, 0);
  }
});
test("BM25 uses titles twice, caps the positive pool and ignores document order", () => {
  const docs = [
    { id: "title", title: "thyroid", abstract: "irrelevant", tags: [] },
    { id: "body", title: "irrelevant", abstract: "thyroid", tags: [] },
  ];
  assert.equal(retrieve(docs, "thyroid", 6).ranked[0].document.id, "title");
  const many = Array.from({ length: 100 }, (_, i) => ({ ...docs[0], id: String(i).padStart(3, "0") }));
  assert.equal(retrieve(many, "thyroid", 6).ranked.length, 40);
  assert.equal(retrieve(many, "thyroid", 20).ranked.length, 80);
  assert.deepEqual(retrieve(many, "thyroid", 6), retrieve([...many].reverse(), "thyroid", 6));
});
test("dictionary boundaries do not interpret ct inside unrelated words", () => {
  assert.deepEqual(expandedQuery("electrical activity").expandedTerms, []);
  assert.ok(expandedQuery("CT reconstruction").expandedTerms.includes("computed tomography"));
  assert.deepEqual(retrievalTokens("the nodules detected and detecting"), ["nodule", "detect", "detect"]);
});
test("landscape MMR diversifies tags within a time/source stratum", () => {
  const papers = Array.from({ length: 12 }, (_, i) => ({
    ...row(`p${String(i).padStart(2, "0")}`, `Work ${i}`),
    tracks: [i < 10 ? "segmentation" : "registration"],
  }));
  const result = prepareAiEvidence(papers, { ...spec, mode: "landscape", question: "" }, 2, now);
  assert.deepEqual(
    new Set(result.papers.flatMap((p) => p.tracks)),
    new Set(["segmentation", "registration"]),
  );
  assert.equal(result.retrieval, undefined);
});
test("joint candidate cap spans kinds and selection keeps time/source diversity", () => {
  const papers = Array.from({ length: 60 }, (_, i) => ({
    ...row(`p${i}`, `thyroid study ${i}`),
    source: i % 2 ? "A" : "B",
    publishedAt: i % 2 ? "2026-02-01" : "2026-09-01",
  }));
  const result = selectAiEvidence(
    papers.map((paper) => ({ paper, day: paper.publishedAt })),
    spec,
    6,
  );
  assert.equal(result.retrieval?.candidates, 40);
  assert.equal(new Set(result.selected.map((w) => w.paper.source)).size, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { abstractExcerpt, prepareAiEvidence, buildAiMessages } from "../lib/ai-evidence";
import { buildBudgetedAiMessages, aiEvidenceBatches, buildAiSynthesis } from "../lib/ai-client";
import { aiSampleLimit, estimatedInputTokens, LOCAL_AI_MODELS } from "../lib/ai-models";
import type { Paper } from "../lib/types";
const paper = (id: string, abstract: string): Paper => ({
  id,
  title: `Medical imaging ${id}`,
  abstract,
  authors: [],
  affiliations: [],
  doi: null,
  source: "Test",
  sources: ["Test"],
  status: "published",
  publishedAt: "2026-09-01",
  updatedAt: null,
  firstSeenAt: "2026-09-02",
  venue: null,
  url: "https://example.org",
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
test("budget estimator follows specified English and Chinese approximation", () => {
  assert.equal(estimatedInputTokens([{ content: "a".repeat(400) }]), 300);
  assert.equal(estimatedInputTokens([{ content: "中".repeat(150) }]), 300);
  assert.equal(aiSampleLimit("quick", "local", LOCAL_AI_MODELS[0].id), 4);
  assert.equal(aiSampleLimit("quick", "local", LOCAL_AI_MODELS[1].id), 6);
});
test("long background does not crowd out methods results and limitations", () => {
  const abstract =
    "BACKGROUND: " +
    "Imaging is useful. ".repeat(100) +
    " METHODS: We developed a three dimensional reconstruction network." +
    " RESULTS: External validation achieved comparable accuracy." +
    " CONCLUSION: Clinical benefit remains untested; performance was not superior.";
  const excerpt = abstractExcerpt(paper("a", abstract), 500);
  assert.ok(excerpt.length <= 500);
  assert.match(excerpt, /three dimensional/);
  assert.match(excerpt, /External validation/);
  assert.match(excerpt, /not superior/);
  assert.match(excerpt, /excerpt omitted/);
});
test("every local model budgets actual prompts and preserves all selected IDs without more batches", () => {
  const data = prepareAiEvidence(
    Array.from({ length: 24 }, (_, i) =>
      paper(String(i), "背景说明。".repeat(600) + " 方法：构建分割模型。 结果：多中心测试仍有局限。"),
    ),
    {
      mode: "landscape",
      question: "",
      locale: "zh",
      from: "2026-01-01",
      to: "2026-10-20",
      horizonMonths: 6,
    },
    24,
    new Date("2026-10-21"),
  );
  for (const model of LOCAL_AI_MODELS) {
    assert.ok(model.inputTokens + model.outputTokens < model.contextTokens);
    const batches = aiEvidenceBatches(data, true, model.id);
    assert.ok(batches.length <= 4);
    assert.deepEqual(
      batches.flat().map((p) => p.id),
      data.papers.map((p) => p.id),
    );
    for (const batch of batches) {
      const messages = buildBudgetedAiMessages({ ...data, papers: batch }, true, model.id);
      assert.ok(estimatedInputTokens(messages) <= model.inputTokens);
      const supplied = JSON.parse(messages[1].content).papers;
      assert.deepEqual(
        supplied.map((p: { id: string }) => p.id),
        batch.map((p) => p.id),
      );
    }
    const synthesis = buildAiSynthesis(
      data,
      [{ summary: "Limited", findings: [], limitations: ["No evidence"] }],
      true,
      model.id,
    );
    assert.ok(estimatedInputTokens(synthesis.messages) <= model.inputTokens);
  }
});

test("tight budgets retain whole sentences, complete markers, and negative conclusions", () => {
  const source =
    "BACKGROUND: " +
    "An imaging challenge. ".repeat(60) +
    " METHODS: We developed a thyroid ultrasound model using a prospective cohort." +
    " RESULTS: We achieved a sensitivity of 80 percent." +
    " FINDINGS: The external test performed poorly." +
    " CONCLUSION: Clinical benefit remains untested; performance was not superior.";
  const record = paper("tight", source);
  for (const budget of [300, 180, 80]) {
    const excerpt = abstractExcerpt(record, budget);
    assert.ok(excerpt.length <= budget);
    assert.match(excerpt, /CONCLUSION: Clinical benefit remains untested; performance was not superior\./);
    const passages = excerpt.split("\n[... excerpt omitted ...]\n");
    for (const passage of passages) assert.ok(source.includes(passage));
    assert.ok(!excerpt.startsWith("[..."));
    assert.ok(!excerpt.endsWith("excerp"));
  }
  assert.equal(record.abstract, source);
  assert.match(
    abstractExcerpt(
      paper("chinese", "背景说明。".repeat(100) + "方法：构建分割模型。结果：多中心测试仍有局限。"),
      80,
    ),
    /局限。/,
  );
});

test("an oversized source sentence is explicitly omitted rather than clipped", () => {
  const original = "METHODS: " + "observational ".repeat(100) + "not superior.";
  const record = { ...paper("long-sentence", "Display translation"), originalAbstract: original };
  const data = prepareAiEvidence(
    [record],
    { mode: "landscape", question: "", locale: "en", from: "2026-01-01", to: "2026-10-20", horizonMonths: 6 },
    4,
    new Date("2026-10-21"),
  );
  for (const budget of [180, 80]) {
    assert.equal(abstractExcerpt(record, budget), "");
    const messages = buildAiMessages(data, budget);
    const projected = JSON.parse(messages[1].content).papers[0];
    assert.equal(projected.id, record.id);
    assert.equal(projected.abstract, "");
    assert.equal(projected.abstractExcerptStatus, "omitted-budget");
    assert.match(messages[0].content, /not missing source data/);
  }
  assert.equal(record.originalAbstract, original);
  assert.equal(record.abstract, "Display translation");
});

test("the actual smallest-model request preserves a complete caveat under a long Chinese question", () => {
  const original =
    "BACKGROUND: " +
    "An imaging challenge. ".repeat(60) +
    " METHODS: We developed a thyroid ultrasound model using a prospective cohort. RESULTS: We achieved a sensitivity of 80 percent. FINDINGS: The external test performed poorly. CONCLUSION: Clinical benefit remains untested; performance was not superior.";
  const question = "甲状腺超声分割的局限".repeat(200);
  const records = Array.from({ length: 4 }, (_, index) => ({
    ...paper(String(index), original),
    title: "甲状腺超声".repeat(100),
  }));
  const data = prepareAiEvidence(
    records,
    { mode: "interest", question, locale: "zh", from: "2026-01-01", to: "2026-10-20", horizonMonths: 6 },
    4,
    new Date("2026-10-21"),
  );
  const model = LOCAL_AI_MODELS[0];
  const batches = aiEvidenceBatches(data, true, model.id);
  assert.equal(batches.length, 1);
  const messages = buildBudgetedAiMessages(data, true, model.id);
  const body = JSON.parse(messages[1].content);
  assert.ok(estimatedInputTokens(messages) <= model.inputTokens);
  assert.equal(body.request.question, question);
  assert.deepEqual(
    body.papers.map((p: { id: string }) => p.id),
    data.papers.map((p) => p.id),
  );
  for (const projected of body.papers) {
    assert.match(projected.abstract, /not superior\./);
    assert.equal(projected.abstractExcerptStatus, "excerpted");
  }
  for (const record of records) assert.equal(record.abstract, original);
});

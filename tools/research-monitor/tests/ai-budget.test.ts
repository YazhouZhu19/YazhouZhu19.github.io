import test from "node:test";
import assert from "node:assert/strict";
import { abstractExcerpt, prepareAiEvidence } from "../lib/ai-evidence";
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

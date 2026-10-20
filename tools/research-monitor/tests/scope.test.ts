import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  INTEREST_TAXONOMY_VERSION,
  reclassifyPapers,
  scopeOf,
  SCOPE_CLASSIFIER_VERSION,
  withPaperScope,
} from "../lib/classify";
import { normalizeRecord, parseMonitorData } from "../lib/record";
import { monitorDataSchema } from "../lib/public-data-schema";

test("scope separates computational imaging, imaging accuracy and incidental drug trials", () => {
  const fixtures = [
    ["Deep learning for liver CT", "We evaluate a neural network for image analysis.", "core"],
    [
      "Liver CT diagnostic accuracy",
      "A cohort study assesses diagnostic accuracy against pathology.",
      "adjacent",
    ],
    [
      "MRI appearances of renal disease",
      "Two readers describe the characteristic imaging findings.",
      "adjacent",
    ],
    [
      "Filgotinib for rheumatoid arthritis",
      "A randomized double-blind placebo trial assesses response. MRI is a secondary endpoint.",
      "out",
    ],
    ["Plant disease classifier", "Deep learning detects lesions on crop images.", "out"],
    ["Clinical questionnaire", "Questionnaire responses predict recovery without imaging endpoints.", "out"],
  ] as const;
  for (const [title, abstract, expected] of fixtures) {
    const result = scopeOf(title, abstract);
    assert.equal(result.scope, expected, title);
    assert.ok(result.reasons.length, title);
  }
});

test("negated methods alone cannot promote clinical studies, but later affirmative evidence can", () => {
  assert.equal(
    scopeOf("MRI clinical appearances", "We use no AI or deep learning. Readers describe images.").scope,
    "adjacent",
  );
  assert.equal(
    scopeOf("Brain MRI", "Imaging was reviewed without software or neural networks.").scope,
    "adjacent",
  );
  assert.equal(
    scopeOf("Brain MRI", "No AI was used for recruitment; however, a neural network segmented the images.")
      .scope,
    "core",
  );
  assert.equal(
    scopeOf("MRI research", "Not only deep learning but also reader comparisons were evaluated.").scope,
    "core",
  );
  assert.equal(scopeOf("Self-supervised medical image analysis", "").scope, "core");
  assert.ok(
    scopeOf("Self-supervised medical image analysis", "").reasons.some((reason) =>
      reason.includes("缺少摘要"),
    ),
  );
});

test("scope is independent of the stable track taxonomy and never removes track labels", () => {
  assert.equal(INTEREST_TAXONOMY_VERSION, "2026-09-18-ten-interests-v1");
  const candidate = classify("MRI diagnostic accuracy", "A cohort study assesses diagnostic accuracy.");
  assert.equal(candidate.scope, "adjacent");
  assert.ok(candidate.tracks.includes("diagnosis"));
  assert.equal(candidate.scopeClassifierVersion, SCOPE_CLASSIFIER_VERSION);
});

test("scope backfill and explicit reclassification preserve identity, order and custom metadata", () => {
  const records = [
    {
      id: "same",
      title: "MRI algorithm",
      abstract: "Deep learning",
      scope: "out" as const,
      scopeReasons: ["old"],
      scopeClassifierVersion: "old",
      custom: 1,
    },
    { id: "same", title: "MRI findings", abstract: "Clinical appearances", custom: 2 },
  ];
  const before = structuredClone(records);
  const revised = reclassifyPapers(records);
  assert.equal(revised.length, records.length);
  assert.deepEqual(
    revised.map((p) => [p.id, p.custom]),
    [
      ["same", 1],
      ["same", 2],
    ],
  );
  assert.deepEqual(records, before);
  assert.equal(withPaperScope(records[0]).scope, "core");
  assert.equal(withPaperScope(records[0]).scopeClassifierVersion, SCOPE_CLASSIFIER_VERSION);
  assert.throws(() => reclassifyPapers([{ title: "A", abstract: null as unknown as string }]), /停止重分类/);
});

test("historical public validation and collection normalization both compute missing or stale scope", () => {
  const raw = normalizeRecord(
    {
      id: "paper:one",
      title: "An algorithm for MRI",
      abstract: "Automated image analysis.",
      source: "fixture",
      url: "https://example.org/paper",
      publishedAt: "2026-10-20",
    },
    "2026-10-21T00:00:00Z",
  );
  const old = { ...raw, scope: "out", scopeReasons: ["old"], scopeClassifierVersion: "old" };
  const snapshot = {
    papers: [old],
    runs: [],
    queryRuns: [],
    collectedAt: "2026-10-21T00:00:00Z",
    lastSuccessfulSync: null,
    coverage: "fixture",
  };
  const current = monitorDataSchema.parse(snapshot);
  assert.equal(current.papers[0].scope, "core");
  assert.equal(current.papers[0].scopeClassifierVersion, SCOPE_CLASSIFIER_VERSION);
  assert.equal(parseMonitorData(snapshot).papers[0].scope, "core");
  assert.equal(old.scope, "out");
  assert.throws(() =>
    monitorDataSchema.parse({ ...snapshot, papers: [{ ...old, url: "javascript:alert(1)" }] }),
  );
});

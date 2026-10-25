import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  encodeCsv,
  parseEvalCsv,
  stratifiedSample,
  stratumFor,
  type EvalEvidence,
  type EvalRow,
} from "../scripts/export-eval-sample";
import { annotationStatus, binaryMetrics, evaluateLabels } from "../scripts/eval-classifier";

function paper(id: string, extra: Partial<EvalEvidence> = {}): EvalEvidence {
  return {
    id,
    title: "Deep learning for medical image segmentation",
    abstract: "MRI segmentation algorithm.",
    source: "arxiv",
    publishedAt: "2026-09-15",
    tracks: ["segmentation"],
    tasks: ["segmentation"],
    ...extra,
  };
}

function label(id: string, scope: string, tracks = ""): EvalRow {
  return {
    id,
    title: "sample",
    abstract_excerpt: "evidence",
    current_tracks: "",
    current_tasks: "",
    label_scope: scope,
    label_tracks: tracks,
    notes: scope ? "Independent draft evidence assessment." : "",
  };
}

test("evaluation sampling is seeded, order independent, without replacement, and covers scarce strata", () => {
  const population = [
    ...Array.from({ length: 30 }, (_, index) => paper(`common-${index}`)),
    paper("rare-source", { source: "europepmc" }),
    paper("rare-month", { publishedAt: "2025-01-01" }),
    paper("rare-track", { tracks: ["registration"] }),
  ];
  const sample = stratifiedSample(population, 12, "fixed");
  assert.deepEqual(sample, stratifiedSample([...population].reverse(), 12, "fixed"));
  assert.notDeepEqual(sample, stratifiedSample(population, 12, "different"));
  assert.equal(new Set(sample.map((row) => row.id)).size, 12);
  assert.ok(["rare-source", "rare-month", "rare-track"].every((id) => sample.some((row) => row.id === id)));
  assert.equal(new Set(sample.map((row) => stratumFor(row, "fixed"))).size, 4);
  assert.throws(() => stratifiedSample(population, 34), /Sample size/);
  assert.throws(() => stratifiedSample([paper("same"), paper("same")], 1), /Duplicate/);
});

test("multi-track strata remain deterministic when stored tag order changes", () => {
  const a = paper("multi", { tracks: ["language", "segmentation", "language"] });
  const b = { ...a, tracks: ["segmentation", "language"] };
  assert.equal(stratumFor(a), stratumFor(b));
  assert.match(stratumFor(paper("unknown", { tracks: [], publishedAt: "unknown" })), /unassigned.*undated/);
  assert.match(stratumFor(paper("invalid", { publishedAt: "2026-02-31" })), /undated/);
  assert.match(stratumFor(paper("offset", { publishedAt: "2026-10-01T00:00:00+08:00" })), /2026-10/);
});

test("evaluation CSV preserves Unicode, quoted commas, quotes and embedded newlines", () => {
  const row = {
    ...label("doi:sample", "core", "segmentation"),
    title: '医学影像, "Title"',
    abstract_excerpt: "first line\nsecond line",
    notes: 'Method says "segmentation", not screening.',
  };
  const csv = encodeCsv([row]);
  const parsed = parseEvalCsv(csv);
  assert.deepEqual(parsed.rows, [row]);
  assert.match(parsed.comments[0], /provisional labels, pending maintainer review/);
  assert.deepEqual(parseEvalCsv(csv.replaceAll("\n", "\r\n")).rows[0].title, row.title);
  assert.throws(() => parseEvalCsv(csv.replace(/"\n$/, "\n")), /Unclosed/);
  assert.throws(() => parseEvalCsv(encodeCsv([row, row])), /duplicate/i);
});

test("provisional annotations cannot become gold by renaming the file alone", () => {
  assert.equal(
    annotationStatus("eval/relevance-sample.csv", ["# maintainer-reviewed: maintainer, 2026-10-21"]),
    "provisional",
  );
  assert.equal(
    annotationStatus("eval/relevance-gold.csv", ["# provisional labels, pending maintainer review"]),
    "provisional",
  );
  assert.equal(annotationStatus("eval/relevance-gold.csv", []), "provisional");
  assert.equal(
    annotationStatus("eval/relevance-gold.csv", ["# maintainer-reviewed: maintainer, 2026-10-21"]),
    "maintainer-reviewed",
  );
  assert.equal(
    annotationStatus("eval/relevance-gold.csv", ["# maintainer-reviewed: maintainer", "# provisional"]),
    "provisional",
  );
});

test("scope confusion and per-track metrics use independent labels, excluding unlabelled rows", () => {
  const evidence = [
    paper("core"),
    paper("clinical", { title: "MRI diagnostic accuracy", abstract: "Clinical MRI reader comparison." }),
    paper("industrial", { title: "Industrial defect images", abstract: "Steel surface inspection." }),
    paper("drug", {
      title: "Drug trial in diagnosed patients",
      abstract: "MRI was used as an ancillary endpoint.",
    }),
    paper("pending"),
  ];
  const result = evaluateLabels(
    [
      label("core", "core", "segmentation"),
      label("clinical", "adjacent", "diagnosis"),
      label("industrial", "out"),
      label("drug", "out"),
      label("pending", ""),
    ],
    evidence,
    (record) => ({
      scope: record.id === "industrial" ? "out" : "core",
      tracks:
        record.id === "core"
          ? ["segmentation"]
          : ["clinical", "drug"].includes(record.id)
            ? ["diagnosis"]
            : [],
    }),
  );
  assert.equal(result.evaluated, 4);
  assert.equal(result.unlabelled, 1);
  assert.deepEqual(result.confusion, [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
  ]);
  assert.equal(result.scope.core.precision, 1 / 3);
  assert.equal(result.scope.adjacent.precision, null);
  assert.equal(result.scope.adjacent.recall, 0);
  assert.equal(result.tracks.segmentation.f1, 1);
  assert.equal(result.tracks.diagnosis.precision, 0.5);
  assert.throws(() => evaluateLabels([label("missing", "core")], evidence), /Missing frozen/);
  assert.throws(() => evaluateLabels([label("core", "wrong")], evidence), /Invalid scope/);
  assert.throws(() => evaluateLabels([label("core", "core", "not-a-track")], evidence), /Unknown track/);
  assert.throws(() => evaluateLabels([{ ...label("core", "core"), notes: "" }], evidence), /reasoning/);
});

test("undefined metrics do not report a misleading perfect score", () => {
  assert.deepEqual(binaryMetrics([], []), {
    tp: 0,
    fp: 0,
    fn: 0,
    support: 0,
    precision: null,
    recall: null,
    f1: null,
  });
  assert.equal(binaryMetrics([true], [false]).f1, 0);
  assert.equal(binaryMetrics([false], [true]).precision, 0);
  assert.throws(() => binaryMetrics([true], []), /Mismatched/);
});

test("committed draft covers all 400 frozen papers, with evidence checksum and per-record reasons", async () => {
  const evidence = JSON.parse(
    await readFile(new URL("../eval/relevance-evidence.json", import.meta.url), "utf8"),
  );
  const { rows, comments } = parseEvalCsv(
    await readFile(new URL("../eval/relevance-sample.csv", import.meta.url), "utf8"),
  );
  assert.equal(rows.length, 400);
  assert.equal(evidence.papers.length, 400);
  assert.equal(new Set(rows.map((row) => row.id)).size, 400);
  assert.equal(
    createHash("sha256").update(JSON.stringify(evidence.papers)).digest("hex"),
    evidence.evidenceSha256,
  );
  assert.equal(annotationStatus("eval/relevance-sample.csv", comments), "provisional");
  assert.ok(rows.every((row) => row.label_scope && row.notes.length > 20));
  for (const row of rows) {
    const frozen = evidence.papers.find((record: EvalEvidence) => record.id === row.id);
    assert.equal(row.title, frozen.title);
    assert.equal(row.abstract_excerpt, [...frozen.abstract].slice(0, 600).join(""));
  }
  const sentinel = rows.find((row) => /filgotinib/i.test(row.title));
  assert.ok(sentinel);
  assert.equal(sentinel.label_scope, "out");
});

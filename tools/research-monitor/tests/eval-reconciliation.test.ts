import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { annotationStatus } from "../scripts/eval-classifier";
import { parseEvalCsv } from "../scripts/export-eval-sample";

const file = (name: string) => new URL(`../eval/${name}`, import.meta.url);
const json = async (name: string) => JSON.parse(await readFile(file(name), "utf8"));
const labels = (row: { scope: string; tracks: string[] }) => ({
  scope: row.scope,
  tracks: [...row.tracks].sort(),
});

test("AI reconciliation preserves the original audit files and all 400 frozen IDs", async () => {
  const audit = await json("reconciliation.json");
  for (const [name, expected] of Object.entries(audit.sourceFileSha256)) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(file(name)))
        .digest("hex"),
      expected,
      `${name} changed after reconciliation`,
    );
  }
  const evidence = await json("relevance-evidence.json");
  const next = await json("relevance-ai-reviewed-annotations.json");
  const { rows, comments } = parseEvalCsv(await readFile(file("relevance-ai-reviewed.csv"), "utf8"));
  const ids = evidence.papers.map((paper: { id: string }) => paper.id).sort();
  assert.equal(rows.length, 400);
  assert.deepEqual(Object.keys(next).sort(), ids);
  assert.deepEqual(rows.map((row) => row.id).sort(), ids);
  assert.equal(audit.evidenceSha256, evidence.evidenceSha256);
  assert.equal(annotationStatus("eval/relevance-ai-reviewed.csv", comments), "provisional");
  assert.equal(
    annotationStatus("eval/relevance-gold.csv", comments),
    "provisional",
    "Renaming the reconciled draft must not create gold",
  );
  for (const row of rows) {
    assert.equal(row.label_scope, next[row.id].scope);
    assert.deepEqual(row.label_tracks.split(";").filter(Boolean), next[row.id].tracks);
    assert.equal(row.notes, next[row.id].notes);
    assert.equal(next[row.id].review.humanConfirmed, false);
    assert.equal(next[row.id].review.status, "provisional");
  }
});

test("only supported portions of the 67 proposed changes enter the AI-reconciled labels", async () => {
  const audit = await json("reconciliation.json");
  const second = await json("second-review.json");
  const original = await json("relevance-annotations.json");
  const next = await json("relevance-ai-reviewed-annotations.json");
  const suggestions = new Map<string, any>(
    second.records
      .filter((row: any) => row.reviewStatus === "change_suggested")
      .map((row: any) => [row.id, row]),
  );
  assert.equal(audit.decisions.length, 67);
  assert.deepEqual(audit.decisions.map((row: any) => row.id).sort(), [...suggestions.keys()].sort());
  const counts = { accepted: 0, partially_accepted: 0, deferred: 0 };
  for (const row of audit.decisions) {
    const expected = suggestions.get(row.id)!;
    assert.deepEqual(labels(row.original), labels(original[row.id]));
    assert.deepEqual(labels(row.secondReviewSuggested), labels(expected.suggested));
    assert.deepEqual(labels(row.reconciled), labels(next[row.id]));
    assert.equal(row.evidenceBasis, "full_frozen_title_and_abstract");
    assert.equal(row.humanConfirmed, false);
    assert.ok(row.reason.length > 20);
    counts[row.decision as keyof typeof counts]++;
    if (row.decision === "accepted") assert.deepEqual(labels(row.reconciled), labels(expected.suggested));
    else if (row.decision === "deferred") assert.deepEqual(labels(row.reconciled), labels(original[row.id]));
    else {
      assert.notDeepEqual(labels(row.reconciled), labels(original[row.id]));
      assert.notDeepEqual(labels(row.reconciled), labels(expected.suggested));
      assert.ok(row.pendingBoundaryDecisions.length > 0);
      for (const track of row.reconciled.tracks) {
        assert.ok(
          row.original.tracks.includes(track) || expected.suggested.tracks.includes(track),
          "No unreviewed track additions",
        );
      }
      for (const track of row.original.tracks) {
        assert.ok(
          row.reconciled.tracks.includes(track) || !expected.suggested.tracks.includes(track),
          "No unreviewed track deletions",
        );
      }
    }
  }
  assert.deepEqual(counts, { accepted: 42, partially_accepted: 9, deferred: 16 });
  const changed = Object.keys(original).filter(
    (id) => JSON.stringify(labels(original[id])) !== JSON.stringify(labels(next[id])),
  );
  assert.equal(changed.length, 51);
  assert.equal(changed.filter((id) => original[id].scope !== next[id].scope).length, 3);
  assert.equal(audit.counts.humanConfirmedRecords, 0);
});

test("all 85 boundary cases and 31 missing abstracts keep unconfirmed original labels", async () => {
  const audit = await json("reconciliation.json");
  const second = await json("second-review.json");
  const original = await json("relevance-annotations.json");
  const next = await json("relevance-ai-reviewed-annotations.json");
  for (const [status, count] of [
    ["agree", 217],
    ["boundary_review_required", 85],
    ["missing_abstract_unverified", 31],
  ] as const) {
    const ids = second.records.filter((row: any) => row.reviewStatus === status).map((row: any) => row.id);
    assert.equal(ids.length, count);
    assert.deepEqual([...audit.retainedWithoutLabelChanges[status]].sort(), [...ids].sort());
    for (const id of ids) {
      assert.deepEqual(labels(next[id]), labels(original[id]));
      assert.equal(next[id].review.humanConfirmed, false);
      assert.equal(next[id].review.secondReviewStatus, status);
      if (status === "boundary_review_required") assert.match(next[id].notes, /boundary unresolved/);
      if (status === "missing_abstract_unverified")
        assert.match(next[id].notes, /title-only labels retained and unverified/);
    }
  }
});

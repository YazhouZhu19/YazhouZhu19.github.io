import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectWorkGroups } from "../scripts/report-work-groups";
import { normalizeRecord } from "../lib/record";

test("the reproducible 20-group audit retains exact source evidence and never claims human confirmation", async () => {
  const result = JSON.parse(await readFile("eval/work-groups.json", "utf8"));
  const review = JSON.parse(await readFile("eval/work-groups-review.json", "utf8"));
  assert.equal(review.status, "provisional-ai-reviewed");
  assert.equal(review.humanReviewed, false);
  assert.equal(review.groups.length, 20);
  assert.equal(new Set(review.groups.map((g: { id: string }) => g.id)).size, 20);
  for (const group of review.groups) {
    const saved = result.duplicateGroups.find((g: { id: string }) => g.id === group.id);
    assert.ok(saved);
    assert.equal(group.humanConfirmed, false);
    assert.equal(group.aiReviewed, true);
    assert.ok(group.aiReason.length > 40);
    assert.deepEqual(group.records, saved.records);
    assert.deepEqual(
      group.evidence.map((e: { id: string }) => e.id),
      saved.records.map((r: { id: string }) => r.id),
    );
    assert.deepEqual(group.matches, saved.matches);
  }
  assert.equal(
    result.recordCount - result.workCount,
    result.duplicateGroups.reduce((sum: number, g: { records: unknown[] }) => sum + g.records.length - 1, 0),
  );
});

test("audit generation is deterministic and preserves the input records", () => {
  const papers = ["a", "b", "c"].map((id) =>
    normalizeRecord(
      {
        id,
        title: id === "c" ? "Unrelated study" : "Medical imaging study",
        abstract: "Public evidence",
        authors: [{ name: "Alice Smith", affiliations: [] }],
        publishedAt: "2026-10-01",
        source: "fixture",
        url: `https://example.org/${id}`,
      },
      "2026-10-21T00:00:00Z",
    ),
  );
  const before = structuredClone(papers);
  const result = inspectWorkGroups(papers, "2026-10-21T00:00:00Z");
  assert.deepEqual(result, inspectWorkGroups([...papers].reverse(), "2026-10-21T00:00:00Z"));
  assert.deepEqual(papers, before);
  assert.equal(result.workCount, 2);
  assert.equal(result.sample.humanReviewed, false);
  assert.equal(result.sample.groups[0].aiReviewed, false);
});

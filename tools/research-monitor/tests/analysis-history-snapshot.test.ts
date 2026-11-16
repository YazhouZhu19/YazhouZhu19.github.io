import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import history from "../data/analysis-history.json";

test("native history ships the approved dated audit, with source fingerprints intact", () => {
  const audit = JSON.parse(readFileSync("docs/research-history-audit.json", "utf8"));
  assert.deepEqual(history, audit.history);
  assert.equal(history.asOf, "2026-11-17");
  assert.equal(history.enrichedPaperCount, 14);
  assert.equal(history.basePaperCount, 5330);
  assert.equal(history.directions.length, 3);
  assert.deepEqual(
    history.directions.filter((d) => d.evidenceStatus === "sufficient").map((d) => d.id),
    ["spinal-cord-mri"],
  );
  for (const { file, sha256 } of audit.fingerprints) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(`data/research-history/${file}`))
        .digest("hex"),
      sha256,
    );
  }
});

test("published history includes source views without raw abstracts or private local paths", () => {
  const serialized = JSON.stringify(history);
  assert.doesNotMatch(serialized, /rawAbstract|rawFile|\/Users\/|file:\/\/|{{SECRET_/);
  for (const direction of history.directions) {
    for (const source of direction.sources) {
      assert.ok(/^https?:$/.test(new URL(source.url).protocol));
      assert.ok(source.retrievedAt <= history.asOf);
    }
    for (const paper of direction.papers) {
      assert.ok(paper.date <= history.asOf);
      assert.ok(/^https?:$/.test(new URL(paper.url).protocol));
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecord } from "../lib/record";
import { matchesPaperScope, paperScopeCounts } from "../lib/paper-scope";

const records = [
  ["core", "Deep learning for liver CT", "A neural network segments the liver."],
  ["adjacent", "Liver CT diagnostic accuracy", "Two readers assess diagnostic accuracy."],
  ["out", "Drug response", "A placebo trial uses MRI as a secondary endpoint."],
].map(([id, title, abstract]) => normalizeRecord({ id, title, abstract }, "2026-10-20T00:00:00Z"));

test("research scope defaults to methods and expands without losing records", () => {
  assert.deepEqual(
    records.filter((p) => matchesPaperScope(p, undefined)).map((p) => p.id),
    ["core"],
  );
  assert.deepEqual(
    records.filter((p) => matchesPaperScope(p, "adjacent")).map((p) => p.id),
    ["core", "adjacent"],
  );
  assert.deepEqual(
    records.filter((p) => matchesPaperScope(p, "all")),
    records,
  );
  assert.deepEqual(paperScopeCounts(records), { core: 1, adjacent: 1, out: 1 });
});
test("old records without scope use the same fallback rules", () => {
  const legacy = records.map(({ scope, scopeReasons, scopeClassifierVersion, ...paper }) => paper);
  assert.deepEqual(paperScopeCounts(legacy), paperScopeCounts(records));
});

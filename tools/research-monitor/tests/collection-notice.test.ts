import assert from "node:assert/strict";
import test from "node:test";
import { collectionNotice } from "../lib/collection-notice";
import { monitorDataSchema } from "../lib/public-data-schema";
import type { MonitorData, SyncRun } from "../lib/types";

const run = (overrides: Partial<SyncRun> = {}): SyncRun => ({
  id: "arxiv-run",
  source: "arXiv",
  startedAt: "2026-10-16T01:32:00Z",
  completedAt: "2026-10-16T01:35:00Z",
  status: "partial",
  received: 900,
  kept: 588,
  added: 15,
  updated: 3,
  total: 41696,
  query: "",
  dateFrom: "",
  dateTo: "2026-10-16",
  coverage: "Limited results",
  ...overrides,
});
const data = (overrides: Partial<MonitorData> = {}): MonitorData => ({
  papers: [],
  runs: [],
  queryRuns: [],
  collectedAt: "2026-10-16T01:35:00Z",
  storageAvailable: true,
  lastSuccessfulSync: "2026-10-16T01:35:00Z",
  coverage: "Limited results",
  ...overrides,
});

test("a single arXiv query failure is a partial-update warning, with its source retained", () => {
  const message = "intervention: request timeout";
  assert.deepEqual(
    collectionNotice(
      data({
        status: "partial",
        error: message,
        errors: [{ source: "arXiv", message }],
        runs: [run({ error: message })],
      }),
    ),
    { severity: "warning", sources: ["arXiv"] },
  );
});

test("a complete collection outage remains an error rather than a warning", () => {
  assert.deepEqual(
    collectionNotice(
      data({ status: "error", runs: [run({ status: "error", received: 0, error: "HTTP 503" })] }),
    ),
    { severity: "error", sources: ["arXiv"] },
  );
  assert.deepEqual(collectionNotice(data({ status: "error" })), { severity: "error", sources: [] });
});

test("successful capped queries do not show a failure notice", () => {
  assert.equal(collectionNotice(data({ status: "partial", runs: [run()] })), null);
});

test("a newer clean source run clears the warning while preserving historical failures", () => {
  assert.equal(
    collectionNotice(
      data({
        status: "partial",
        runs: [run({ error: "timeout" }), run({ id: "recovered", completedAt: "2026-10-16T05:00:00Z" })],
      }),
    ),
    null,
  );
});

test("missing data and legacy source errors keep their existing meaning", () => {
  assert.equal(collectionNotice(undefined), null);
  assert.equal(collectionNotice(null), null);
  assert.deepEqual(collectionNotice(data({ error: "Source failed" })), { severity: "warning", sources: [] });
  assert.deepEqual(collectionNotice(data({ errors: [{ source: "medRxiv", message: "timeout" }] })), {
    severity: "warning",
    sources: ["medRxiv"],
  });
});

test("public snapshot validation preserves outage severity and source-specific error metadata", () => {
  for (const status of ["partial", "error"] as const) {
    const source = data({
      status,
      error: "Source update failed",
      errors: [{ source: "arXiv", message: "timeout" }],
    });
    const parsed = monitorDataSchema.parse(source);
    assert.equal(parsed.status, status);
    assert.deepEqual(parsed.errors, source.errors);
    assert.deepEqual(collectionNotice(parsed), collectionNotice(source));
  }
  const capped = data({ status: "partial", errors: [], runs: [run()] });
  assert.equal(collectionNotice(monitorDataSchema.parse(capped)), null);
  assert.equal(monitorDataSchema.parse(data()).status, undefined);
});

test("public collection status and errors stay bounded and validated", () => {
  for (const invalid of [
    { status: "unknown" },
    { errors: [{ source: "arXiv", message: 503 }] },
    { errors: [{ source: "arXiv", message: "x".repeat(10001) }] },
    { errors: Array.from({ length: 1001 }, () => ({ source: "arXiv", message: "timeout" })) },
  ])
    assert.equal(monitorDataSchema.safeParse({ ...data(), ...invalid }).success, false);
});

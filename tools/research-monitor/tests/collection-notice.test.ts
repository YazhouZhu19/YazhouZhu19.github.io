import assert from "node:assert/strict";
import test from "node:test";
import { collectionNotice } from "../lib/collection-notice";
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

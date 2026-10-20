import assert from "node:assert/strict";
import test from "node:test";
import { parseEpmc } from "../lib/parse";
import { applyOutcomes, mergeRecord, normalizeRecord, parseMonitorData } from "../lib/record";
import { buildDashboard, defaultDashboardFilters } from "../lib/dashboard";
import { buildPreliminaryAnalysis } from "../lib/analysis";
import { prepareAiEvidence } from "../lib/ai-evidence";
import { buildForesight } from "../lib/foresight";
import { monitorDataSchema } from "../lib/public-data-schema";
import type { MonitorData, Paper } from "../lib/types";

const now = "2026-10-21T08:00:00Z";
const query = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=MRI";
const hit = {
  id: "123",
  source: "MED",
  doi: "10.1234/example",
  title: "MRI algorithm",
  abstractText: "We evaluate a medical image segmentation model.",
};
const anomaly = (record: Paper) => record.dateAnomaly;

function paper(id: string, publishedAt: string): Paper {
  return normalizeRecord(
    {
      id,
      title: "MRI algorithm",
      abstract: "Medical image analysis.",
      source: "fixture",
      url: "https://example.org/paper",
      publishedAt,
      firstSeenAt: "2026-10-21T01:00:00Z",
    },
    now,
  );
}
function data(papers: Paper[]): MonitorData {
  return {
    papers,
    totalStored: papers.length,
    runs: [],
    queryRuns: [],
    collectedAt: now,
    initialCollectedAt: "2026-10-01T00:00:00Z",
    storageAvailable: true,
    lastSuccessfulSync: "2026-10-20T00:00:00Z",
    coverage: "fixture",
  };
}

test("Europe PMC retains all original dates and chooses an available electronic or index date", () => {
  const dates = {
    firstPublicationDate: "2027-01-01",
    electronicPublicationDate: "2026-10-15",
    firstIndexDate: "2026-10-12",
  };
  const parsed = parseEpmc({ ...hit, ...dates }, query, now);
  assert.equal(parsed.publishedAt, "2026-10-12");
  assert.equal(anomaly(parsed), undefined);
  assert.deepEqual(parsed.provenance[0].publicationDates, dates);
  assert.equal(parsed.provenance[0].collectedAt, now);
});

test("all-future Europe PMC metadata is retained and flagged without changing identity", () => {
  const parsed = parseEpmc(
    {
      ...hit,
      firstPublicationDate: "2027-01-01",
      electronicPublicationDate: "2026-12-01",
      firstIndexDate: "2026-11-01",
    },
    query,
    now,
  );
  assert.equal(parsed.publishedAt, "2027-01-01");
  assert.equal(anomaly(parsed), "future");
  assert.equal(parsed.id, "doi:10.1234/example");
});

test("incoming valid earlier dates survive merging with an older future-dated record", () => {
  const old = parseEpmc({ ...hit, firstPublicationDate: "2027-01-01" }, query, "2026-10-01T00:00:00Z");
  const incoming = parseEpmc({ ...hit, firstPublicationDate: "2026-10-10" }, query, now);
  const merged = mergeRecord(old, incoming);
  assert.equal(merged.publishedAt, "2026-10-10");
  assert.equal(anomaly(merged), undefined);
  assert.equal(merged.firstSeenAt, old.firstSeenAt);
  assert.equal(merged.id, old.id);
  assert.equal(merged.provenance.length, 2);
  assert.equal(anomaly(old), "future");
  assert.equal(old.publishedAt, "2027-01-01");
});

test("retained-record normalization marks future dates and later collection can clear an elapsed flag", () => {
  const elapsed = Object.assign(paper("elapsed", "2026-10-20"), { dateAnomaly: "future" as const });
  const future = paper("future", "2026-12-01");
  const previous = data([elapsed, future]);
  const result = applyOutcomes(previous, [], now);
  assert.deepEqual(
    result.papers.map((row) => row.id),
    ["elapsed", "future"],
  );
  assert.equal(anomaly(result.papers[0]), undefined);
  assert.equal(anomaly(result.papers[1]), "future");
  assert.equal(result.lastSuccessfulSync, previous.lastSuccessfulSync);
  assert.equal(parseMonitorData(data([{ ...future, dateAnomaly: undefined }])).papers.length, 1);
  assert.equal(anomaly(elapsed), "future");
});

test("public validation backfills old dates, retains source evidence and rejects malformed metadata", () => {
  const future = { ...paper("future", "2026-12-01"), dateAnomaly: undefined };
  const corrected = parseEpmc(
    {
      ...hit,
      firstPublicationDate: "2027-01-01",
      electronicPublicationDate: "2026-10-15",
    },
    query,
    now,
  );
  const input = data([future, corrected]);
  const original = structuredClone(input);
  const validated = monitorDataSchema.parse(input);
  assert.equal(validated.papers[0].dateAnomaly, "future");
  assert.equal(validated.papers[1].publishedAt, "2026-10-15");
  assert.deepEqual(validated.papers[1].provenance[0].publicationDates, {
    firstPublicationDate: "2027-01-01",
    electronicPublicationDate: "2026-10-15",
  });
  assert.equal(validated.papers[1].provenance[0].publicationDateField, "electronicPublicationDate");
  assert.deepEqual(input, original);
  for (const firstIndexDate of [{ value: "2026-10-10" }, "x".repeat(2001)]) {
    assert.equal(
      monitorDataSchema.safeParse(
        data([
          {
            ...corrected,
            provenance: [{ ...corrected.provenance[0], publicationDates: { firstIndexDate } }],
          } as unknown as Paper,
        ]),
      ).success,
      false,
    );
  }
  assert.equal(
    monitorDataSchema.safeParse(data([{ ...future, dateAnomaly: "confirmed" } as unknown as Paper])).success,
    false,
  );
});

test("overview, reading clues and AI evidence consistently exclude flagged and actual future dates", () => {
  const valid = paper("valid", "2026-10-20");
  const flagged = Object.assign(paper("flagged", "2026-10-20"), { dateAnomaly: "future" as const });
  const future = paper("future", "2026-12-01");
  const fixture = data([valid, flagged, future]);
  for (const clock of ["publication", "discovery"] as const) {
    const overview = buildDashboard(
      fixture,
      [],
      { ...defaultDashboardFilters, days: "all", clock },
      new Date(now),
    );
    assert.deepEqual(
      overview.rows.map((row) => row.id),
      ["valid"],
    );
    assert.equal(overview.futureCount, 2);
    assert.deepEqual(
      overview.newToday.map((row) => row.id),
      ["valid"],
    );
    const clues = buildPreliminaryAnalysis(
      fixture,
      { ...defaultDashboardFilters, days: "all", clock },
      [],
      new Date(now),
    );
    assert.deepEqual(
      clues.scope.rows.map((row) => row.id),
      ["valid"],
    );
    assert.equal(clues.scope.excludedFuture, 2);
  }
  const evidence = prepareAiEvidence(
    fixture.papers,
    {
      mode: "landscape",
      from: "2026-10-01",
      to: "2026-10-21",
      horizonMonths: 6,
      question: "",
      locale: "en",
    },
    48,
    new Date(now),
  );
  assert.deepEqual(
    evidence.papers.map((row) => row.id),
    ["valid"],
  );
  assert.equal(evidence.excludedFuture, 2);
  const foresight = buildForesight(fixture.papers, { now: new Date(now) });
  assert.deepEqual(
    foresight.current.map((row) => row.id),
    ["valid"],
  );
  assert.equal(foresight.excludedFuture, 2);
  assert.equal(fixture.papers.length, 3);
});

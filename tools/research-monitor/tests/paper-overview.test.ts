import assert from "node:assert/strict";
import test from "node:test";
import { createPaperOverview } from "../scripts/paper-overview";
import { parsePaperOverview } from "../lib/paper-overview";
import { monitorDataSchema } from "../lib/public-data-schema";
import { normalizeRecord } from "../lib/record";
import { buildDashboard, defaultDashboardFilters } from "../lib/dashboard";
import { buildWorkIndex } from "../lib/paper-works";
import type { Team } from "../lib/types";
const now = "2026-11-05T02:00:00.000Z";
function fixture() {
  const papers = Array.from({ length: 6 }, (_, i) =>
    normalizeRecord(
      {
        id: `record:${i}`,
        title: i < 2 ? "MRI segmentation using deep learning" : `CT tumor diagnosis ${i}`,
        abstract:
          "A deep learning algorithm for medical image segmentation and classification using MRI and CT.",
        authors: [
          {
            name: i < 3 ? "Alex Smith" : "Jane Lee",
            orcid: "0000-0001-0000-0001",
            affiliations: ["Imaging Lab"],
          },
        ],
        source: i % 2 ? "arXiv" : "Europe PMC",
        status: i % 2 ? "preprint" : "published",
        doi: i < 2 ? "10.1234/shared" : null,
        url: `https://example.org/${i}`,
        publishedAt: i === 4 ? "2026-12-01" : `2026-11-0${(i % 3) + 1}`,
        firstSeenAt: i === 5 ? "2026-11-05T01:00:00Z" : "2026-11-01T01:00:00Z",
        provenance: [
          { collectedAt: now, sourceRecordId: `${100 + i}`, queryUrl: "https://example.org/query" },
        ],
      },
      now,
    ),
  );
  return {
    papers: papers.map((paper, i) => ({ ...paper, id: `record:${i}` })),
    runs: [],
    queryRuns: [],
    collectedAt: now,
    lastSuccessfulSync: now,
    coverage: "test",
    storageAvailable: true,
  };
}
function idsOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(idsOnly);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if ("authors" in row && "provenance" in row) return { id: row.id };
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, idsOnly(v)]));
  }
  return value;
}
test("overview preserves all dashboard filters, drill IDs, personal-team matching and work counts", () => {
  const raw = fixture();
  const full = { ...monitorDataSchema.parse(raw), storageAvailable: true };
  const overview = parsePaperOverview(createPaperOverview(raw));
  const teams: Team[] = [
    {
      id: "team",
      name: "Lab",
      members: ["Alex Smith"],
      institution: "Imaging Lab",
      kind: "持续关注",
      createdAt: now,
    },
  ];
  for (const days of ["1", "30", "all"])
    for (const clock of ["publication", "discovery"] as const)
      for (const source of ["all", "arXiv", "Europe PMC"])
        for (const track of ["all", "segmentation"]) {
          const filters = { ...defaultDashboardFilters, days, clock, source, track };
          const before = buildDashboard(full, teams, filters, new Date(now));
          const after = buildDashboard(overview, teams, filters, new Date(now));
          assert.deepEqual(idsOnly(after), idsOnly(before));
          assert.deepEqual(idsOnly(buildWorkIndex(after.rows)), idsOnly(buildWorkIndex(before.rows)));
        }
  assert.equal("abstract" in overview.papers[0], false);
  assert.equal("queryUrl" in overview.papers[0].provenance[0], false);
  assert.equal(raw.papers[0].provenance[0].queryUrl, "https://example.org/query");
});
test("overview rejects duplicate IDs, counts, schema and corrupt dictionary references", () => {
  const raw = createPaperOverview(fixture());
  assert.throws(() => parsePaperOverview({ ...raw, schema: "invalid" }));
  assert.throws(() => parsePaperOverview({ ...raw, records: [...raw.records, raw.records[0]] }));
  assert.throws(() => parsePaperOverview({ ...raw, affiliations: [] }));
  assert.throws(() => parsePaperOverview({ ...raw, metadata: { ...raw.metadata, totalStored: 0 } }));
});

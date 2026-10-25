import assert from "node:assert/strict";
import test from "node:test";
import {
  githubQuality,
  githubQualitySummary,
  hasPaperLink,
  matureGitHubRecords,
} from "../lib/github-quality";
import type { GitHubSignal } from "../lib/research-signals";
const asOf = "2026-10-21T00:00:00Z";
const repo = (extra: Partial<GitHubSignal> = {}): GitHubSignal => ({
  id: "github:a/b",
  kind: "github",
  title: "b",
  fullName: "a/b",
  url: "https://github.com/a/b",
  summary: "MRI segmentation",
  summaryKind: "repository-description",
  publisher: "a",
  publishedAt: asOf,
  firstSeenAt: asOf,
  observedAt: asOf,
  updatedAt: null,
  topics: [],
  sourceId: "github",
  relatedUrls: [],
  stars: 0,
  forks: 0,
  openIssues: 0,
  license: null,
  language: null,
  archived: false,
  pushedAt: null,
  releasedAt: null,
  releaseUrl: null,
  readmeExcerpt: "",
  ...extra,
});
test("maturity follows exact popularity/link boundaries and archive cap", () => {
  assert.equal(githubQuality(repo({ stars: 49 }), asOf).maturity, "early");
  assert.equal(githubQuality(repo({ stars: 50 }), asOf).maturity, "established");
  assert.equal(githubQuality(repo({ forks: 9 }), asOf).maturity, "early");
  assert.equal(githubQuality(repo({ forks: 10 }), asOf).maturity, "established");
  assert.equal(
    githubQuality(repo({ stars: 10, relatedUrls: ["https://doi.org/10.1000/xyz"] }), asOf).maturity,
    "established",
  );
  assert.equal(
    githubQuality(repo({ stars: 9, relatedUrls: ["https://arxiv.org/abs/2410.01234"] }), asOf).maturity,
    "early",
  );
  assert.equal(githubQuality(repo({ stars: 500, archived: true }), asOf).maturity, "active");
});
test("active requires an observed push within 180 days and meaningful supporting metadata", () => {
  const boundary = new Date(Date.parse(asOf) - 180 * 86400000).toISOString();
  assert.equal(githubQuality(repo({ pushedAt: boundary, license: "MIT" }), asOf).maturity, "active");
  assert.equal(
    githubQuality(repo({ pushedAt: new Date(Date.parse(boundary) - 1).toISOString(), license: "MIT" }), asOf)
      .maturity,
    "early",
  );
  for (const pushedAt of [null, "2026-02-30T00:00:00Z", "2026-10-22T00:00:00Z"])
    assert.equal(githubQuality(repo({ pushedAt, stars: 5 }), asOf).maturity, "early");
  assert.equal(
    githubQuality(
      repo({ pushedAt: asOf, stars: 4, license: "NOASSERTION", readmeExcerpt: "a".repeat(199) }),
      asOf,
    ).maturity,
    "early",
  );
  assert.equal(githubQuality(repo({ pushedAt: asOf, stars: 5 }), asOf).maturity, "active");
  assert.equal(
    githubQuality(repo({ pushedAt: asOf, readmeExcerpt: "a".repeat(200) }), asOf).maturity,
    "active",
  );
  assert.equal(
    githubQuality(repo({ pushedAt: asOf, readmeExcerpt: " ".repeat(250) }), asOf).maturity,
    "early",
  );
  assert.equal(githubQuality(repo({ pushedAt: asOf, license: "MIT" }), "broken").maturity, "early");
});
test("paper link recognition rejects lookalike domains and malformed identifiers", () => {
  assert(hasPaperLink(["https://arxiv.org/pdf/hep-th/9901001v2.pdf"]));
  assert(hasPaperLink(["https://doi.org/10.1000/test"]));
  for (const link of [
    "https://doi.org.attacker.test/10.1000/test",
    "https://arxiv.org/abs/not-an-id",
    "https://example.com/?doi=10.1000/test",
    "https://doi.org/%ZZ",
  ])
    assert(!hasPaperLink([link]));
});
test("summary and default selection preserve the input and all library records", () => {
  const records = [
    repo(),
    repo({ id: "github:a/c", stars: 50 }),
    repo({ id: "github:a/d", pushedAt: asOf, license: "MIT" }),
  ];
  const prior = structuredClone(records);
  assert.deepEqual(githubQualitySummary(records, asOf).counts, { established: 1, active: 1, early: 1 });
  assert.equal(matureGitHubRecords(records, asOf).length, 2);
  assert.deepEqual(records, prior);
});

test("default overview excludes early projects while global library totals and lazy drills remain complete", async () => {
  const { buildSignalOverviews } = await import("../scripts/signals-snapshot");
  const { buildGitHubDashboard } = await import("../lib/github-dashboard");
  const { adaptSignalOverview } = await import("../lib/signal-overview");
  const { emptyResearchSignalsData } = await import("../lib/research-signals");
  const records = [
    repo(),
    repo({ id: "github:a/established", stars: 50 }),
    repo({ id: "github:a/active", license: "MIT", pushedAt: asOf }),
  ];
  const overview = buildSignalOverviews({ ...emptyResearchSignalsData(asOf), records }).github;
  assert.equal(overview.model.global.total.count, 3);
  assert.equal(overview.model.rowCount, 2);
  assert.deepEqual(overview.quality?.counts, { established: 1, active: 1, early: 1 });
  const complete = buildGitHubDashboard(
    records,
    { baseRecords: matureGitHubRecords(records, asOf) },
    asOf,
    asOf,
  );
  const preview = adaptSignalOverview(overview);
  assert.deepEqual(
    preview.resolveIds(preview.github.scoped.metrics[0].recordIds, complete).sort(),
    records
      .slice(1)
      .map((record) => record.id)
      .sort(),
  );
  assert.deepEqual(
    preview.resolveIds(preview.github.global.total.recordIds, complete).sort(),
    records.map((record) => record.id).sort(),
  );
});

test("direct audit sampling is deterministic, stratified, and never rewrites relevance", async () => {
  const { sampleDirectRepositories } = await import("../scripts/export-github-review");
  const records = Array.from({ length: 12 }, (_, i) =>
    repo({
      id: `github:a/${i}`,
      stars: i % 3 === 0 ? 50 : 0,
      relevance: { level: i === 0 ? "candidate" : "direct", reasons: ["explicit-medical-imaging"] },
    }),
  );
  const before = structuredClone(records);
  const selected = sampleDirectRepositories(records, asOf, 8);
  assert.deepEqual(sampleDirectRepositories([...records].reverse(), asOf, 8), selected);
  assert.equal(new Set(selected.map((row) => row.record.id)).size, 8);
  assert(selected.every((row) => row.record.relevance?.level === "direct"));
  assert.equal(new Set(selected.map((row) => row.stratum.split("/")[0])).size, 2);
  assert.deepEqual(records, before);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ANALYSIS_RULE_VERSION, analyzeResearch } from "../lib/integrated-analysis";
import { parseAnalysisManifest, parseAnalysisSnapshot } from "../lib/analysis-snapshot";
import { createAnalysisManifest, createAnalysisSnapshot } from "../scripts/analysis-snapshot";
import { monitorDataSchema } from "../lib/public-data-schema";
import type { Paper } from "../lib/types";
import type { ResearchSignalsData, ResearchSignal } from "../lib/research-signals";
const generatedAt = "2026-11-17T00:00:00.000Z";
const collectedAt = "2026-11-15T00:00:00.000Z";
const body =
  "We address limited annotations with U-Net for brain MRI segmentation. Experiments evaluate a benchmark. Results achieve Dice of 0.9. Dataset available at https://zenodo.org/records/123. Code https://github.com/lab/brain.";
function paper(id: string, patch: Partial<Paper> = {}): Paper {
  return {
    id,
    title: "Brain segmentation",
    abstract: body,
    originalAbstract: body,
    authors: [],
    affiliations: [],
    doi: `10.1000/${id}`,
    source: "Europe PMC",
    sources: ["Europe PMC"],
    status: "published",
    publishedAt: "2026-01-01",
    updatedAt: null,
    firstSeenAt: collectedAt,
    venue: null,
    url: `https://example.org/${id}`,
    tasks: [],
    modalities: [],
    organs: [],
    methods: [],
    humanSignals: [],
    evidence: [],
    tracks: [],
    scope: "core",
    reviewStatus: "unreviewed",
    provenance: [],
    ...patch,
  };
}
function signal(id: string, kind: "github" | "news", patch: Record<string, unknown> = {}): ResearchSignal {
  return {
    id,
    kind,
    title: "Medical brain segmentation",
    summary: "Brain MRI U-Net segmentation with limited annotations",
    url: kind === "github" ? "https://github.com/lab/brain" : `https://example.org/news/${id}`,
    summaryKind: kind === "github" ? "repository-description" : "publisher-excerpt",
    publisher: "lab",
    publishedAt: kind === "github" ? "2023-01-01T00:00:00Z" : "2026-10-01T00:00:00Z",
    firstSeenAt: collectedAt,
    observedAt: collectedAt,
    updatedAt: null,
    topics: [],
    sourceId: kind,
    relatedUrls: [],
    relevance: { level: "direct", reasons: ["medical-imaging"] },
    ...(kind === "github"
      ? {
          fullName: "lab/brain",
          stars: 10,
          forks: 1,
          openIssues: 0,
          license: null,
          language: "Python",
          archived: false,
          pushedAt: collectedAt,
          releasedAt: null,
          releaseUrl: null,
          readmeExcerpt: "",
        }
      : { newsType: "research", discoveryUrl: null, originalUrl: null }),
    ...patch,
  } as ResearchSignal;
}
function inputs() {
  const papers: Paper[] = [
    paper("old-a", { publishedAt: "2023-01-01" }),
    paper("old-b", { publishedAt: "2024-01-01" }),
    paper("recent"),
    paper("duplicate", { doi: "10.1000/recent" }),
    paper("out", { scope: "out" }),
    paper("future", { publishedAt: "2027-01-01", dateAnomaly: "future" }),
    ...Array.from({ length: 40 }, (_, i) =>
      paper(`other-${i}`, {
        title: "Medical reconstruction",
        abstract: "MRI reconstruction",
        originalAbstract: "MRI reconstruction",
      }),
    ),
  ];
  const data = monitorDataSchema.parse({
    papers,
    totalStored: papers.length,
    collectedAt,
    lastSuccessfulSync: collectedAt,
    runs: [],
    queryRuns: [],
    coverage: "Synthetic fixture",
    status: "ok",
  });
  // This test isolates analysis from the separately tested scope classifier.
  data.papers = data.papers.map((item, index) => ({ ...item, scope: papers[index].scope ?? "out" }));
  const signals: ResearchSignalsData = {
    schemaVersion: 1,
    generatedAt: collectedAt,
    limitations: [],
    sources: (["github", "news"] as const).map((kind) => ({
      id: kind,
      kind,
      name: kind,
      url: "https://example.org",
      status: "ok",
      checkedAt: collectedAt,
      lastSuccessAt: collectedAt,
      received: 2,
      retained: 2,
      error: null,
      coverage: "Synthetic fixture",
    })),
    records: [
      signal("brain", "github"),
      signal("repost-a", "news", { originalUrl: "https://example.org/original" }),
      signal("repost-b", "news", { originalUrl: "https://example.org/original" }),
      signal("candidate", "news", { relevance: { level: "candidate", reasons: ["uncertain"] } }),
    ],
  };
  return {
    papers: data,
    signals,
    generatedAt,
    paperManifestSha256: "a".repeat(64),
    signalsManifestSha256: "b".repeat(64),
  };
}

test("published analysis is exactly equal to the original algorithm including exclusions, duplicates and niche evidence", () => {
  const input = inputs();
  const snapshot = createAnalysisSnapshot(input);
  assert.deepEqual(
    snapshot.result,
    analyzeResearch({ papers: input.papers.papers, signals: input.signals.records, asOf: "2026-11-17" }),
  );
  assert.equal(snapshot.result.version, ANALYSIS_RULE_VERSION);
  assert.deepEqual(snapshot.result.excluded, { paper: 2, github: 0, news: 1 });
  assert.deepEqual(snapshot.result.duplicates, { paper: 1, github: 0, news: 1 });
  assert.equal(snapshot.result.niches.find((n) => n.id === "segmentation:labels:brain")?.ready, true);
  assert.deepEqual(parseAnalysisSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.equal(snapshot.sources.papers.totalStored, input.papers.papers.length);
  assert.equal(snapshot.sources.signals.totalStored, input.signals.records.length);
  assert.deepEqual(snapshot.sources.signals.states, input.signals.sources);
});

test("generation uses the UTC date, not the local timestamp date or the viewer's clock", () => {
  const input = { ...inputs(), generatedAt: "2026-11-17T00:30:00+08:00" };
  const snapshot = createAnalysisSnapshot(input);
  assert.equal(snapshot.result.asOf, "2026-11-16");
  assert.equal(snapshot.result.windowStart, "2025-11-17");
  assert.deepEqual(
    snapshot.result,
    analyzeResearch({ papers: input.papers.papers, signals: input.signals.records, asOf: "2026-11-16" }),
  );
});

test("rejects incompatible versions, malformed dates and mismatched result/source accounting", () => {
  const good = createAnalysisSnapshot(inputs());
  const corruptions: Array<(value: any) => void> = [
    (v) => {
      v.schema = "oevryn-analysis-v2";
    },
    (v) => {
      v.result.version = "unsupported";
    },
    (v) => {
      v.result.asOf = "2026-02-30";
    },
    (v) => {
      v.result.asOf = "2026-11-16";
    },
    (v) => {
      v.result.windowStart = "2020-01-01";
    },
    (v) => {
      v.generatedAt = "not a date";
    },
    (v) => {
      v.sources.papers.collectedAt = "2027-01-01T00:00:00Z";
    },
    (v) => {
      v.sources.papers.totalStored++;
    },
    (v) => {
      v.sources.signals.totalStored = 0;
    },
    (v) => {
      v.sources.papers.manifestSha256 = "unknown";
    },
    (v) => {
      v.sources.signals.states.push(v.sources.signals.states[0]);
    },
    (v) => {
      v.result.totals.paper = -1;
    },
    (v) => {
      v.result.directions[0].shares.paper = 0.12345;
    },
    (v) => {
      v.result.directions[0].id = v.result.directions[1].id;
    },
    (v) => {
      v.result.niches[0].evidenceStatus = "pending";
    },
    (v) => {
      v.result.niches[0].count = 100000;
    },
    (v) => {
      v.result.extra = "unexpected";
    },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(good);
    corrupt(value);
    assert.throws(() => parseAnalysisSnapshot(value), `Accepted invalid snapshot: ${corrupt}`);
  }
});

test("a manifest identifies exact publication bytes and excludes detailed source states", () => {
  const snapshot = createAnalysisSnapshot(inputs());
  const text = JSON.stringify(snapshot) + "\n";
  const manifest = createAnalysisManifest(snapshot, text);
  assert.equal(manifest.snapshotBytes, Buffer.byteLength(text));
  assert.equal(manifest.snapshotSha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(manifest.asOf, snapshot.result.asOf);
  assert.equal(manifest.ruleVersion, ANALYSIS_RULE_VERSION);
  assert.equal("states" in manifest.sources.signals, false);
  assert.deepEqual(parseAnalysisManifest(JSON.parse(JSON.stringify(manifest))), manifest);
  for (const patch of [
    { snapshotBytes: 0 },
    { snapshotBytes: 9 * 1024 * 1024 },
    { snapshotSha256: "bad" },
    { ruleVersion: "other" },
    { asOf: "2026-11-18" },
    { schema: "other" },
    { extra: true },
  ])
    assert.throws(() => parseAnalysisManifest({ ...manifest, ...patch }));
});

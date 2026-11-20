import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { parseAnalysisManifest, parseAnalysisSnapshot } from "../lib/analysis-snapshot";
import {
  parseAnalysisTransport,
  parseAnalysisManifestV2,
  stableAnalysisContent,
} from "../lib/analysis-transport";
import { analyzeResearch } from "../lib/integrated-analysis";
import { readSignalArchiveFile } from "./signal-archive";
import { parseSignalsManifest } from "../lib/signals-snapshot";
import { parseSnapshotManifest } from "../lib/snapshot";
import { readSnapshotFile } from "./snapshot-files";

// Verify the actual production artifacts against complete real source archives,
// including every niche candidate and source excerpt; never substitute E2E fixtures.
const [
  bootstrapV2Bytes,
  summaryV2Bytes,
  manifestV2Bytes,
  bootstrapManifestV2Bytes,
  bootstrapBytes,
  summaryBytes,
  analysisManifestBytes,
  paperManifestBytes,
  signalManifestBytes,
  signals,
  deploymentBytes,
  papers,
] = await Promise.all([
  readFile("dist/analysis-bootstrap-v2.json"),
  readFile("dist/data/analysis-summary-v2.json"),
  readFile("dist/data/analysis-manifest-v2.json"),
  readFile("dist/analysis-bootstrap-manifest-v2.json"),
  readFile("dist/analysis-bootstrap.json"),
  readFile("dist/data/analysis-summary.json"),
  readFile("dist/data/analysis-manifest.json"),
  readFile("dist/data/public-papers-v3.json"),
  readFile("dist/data/signals-v2/manifest.json"),
  readSignalArchiveFile("data/research-signals.json"),
  readFile("dist/deployment.json", "utf8"),
  readSnapshotFile("data/papers.json"),
]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const snapshot = parseAnalysisSnapshot(JSON.parse(bootstrapBytes.toString("utf8")));
const summary = parseAnalysisSnapshot(JSON.parse(summaryBytes.toString("utf8")));
const manifest = parseAnalysisManifest(JSON.parse(analysisManifestBytes.toString("utf8")));
const paperManifest = parseSnapshotManifest(JSON.parse(paperManifestBytes.toString("utf8")));
const signalManifest = parseSignalsManifest(
  JSON.parse(signalManifestBytes.toString("utf8")),
  signalManifestBytes.length,
);
const deployment = JSON.parse(deploymentBytes);
const snapshotV2 = parseAnalysisTransport(JSON.parse(bootstrapV2Bytes.toString("utf8")));
const summaryV2 = parseAnalysisTransport(JSON.parse(summaryV2Bytes.toString("utf8")));
const manifestV2 = parseAnalysisManifestV2(JSON.parse(manifestV2Bytes.toString("utf8")));
assert.deepEqual(snapshotV2, snapshot, "Compact transport did not restore the complete original snapshot");
assert.deepEqual(
  summaryV2,
  snapshot,
  "Compact data publication did not restore the complete original snapshot",
);
assert.deepEqual(bootstrapV2Bytes, summaryV2Bytes, "Compact web/data payload bytes differ");
assert.deepEqual(bootstrapManifestV2Bytes, manifestV2Bytes, "Compact web/data manifest bytes differ");
assert.equal(manifestV2.snapshotSha256, hash(summaryV2Bytes));
assert.equal(manifestV2.snapshotBytes, summaryV2Bytes.length);
assert.equal(
  manifestV2.contentSha256,
  createHash("sha256").update(stableAnalysisContent(snapshot)).digest("hex"),
);
const {
  contentSha256: _contentHash,
  schema: _v2Schema,
  snapshotSha256: _v2Hash,
  snapshotBytes: _v2Bytes,
  ...v2Metadata
} = manifestV2;
const { schema: _v1Schema, snapshotSha256: _v1Hash, snapshotBytes: _v1Bytes, ...v1Metadata } = manifest;
assert.deepEqual(v2Metadata, v1Metadata);
assert.equal(deployment.analysisSnapshotV2Sha256, hash(summaryV2Bytes));
assert.equal(deployment.analysisManifestV2Sha256, hash(manifestV2Bytes));
assert.equal(deployment.analysisContentSha256, manifestV2.contentSha256);
assert.ok(
  papers.papers.length >= 10000 && signals.records.length >= 50000,
  "Expected complete real source archives, not synthetic browser fixtures",
);
assert.deepEqual(bootstrapBytes, summaryBytes, "Web bootstrap and data summary bytes differ");
assert.deepEqual(snapshot, summary, "Parsed publication copies differ");
assert.equal(
  manifest.snapshotSha256,
  hash(summaryBytes),
  "Analysis manifest digest differs from published bytes",
);
assert.equal(manifest.snapshotBytes, summaryBytes.length, "Analysis manifest byte count differs");
assert.equal(manifest.generatedAt, snapshot.generatedAt);
assert.equal(manifest.asOf, snapshot.result.asOf);
assert.equal(manifest.ruleVersion, snapshot.result.version);
const { states: _states, ...signalSource } = snapshot.sources.signals;
assert.deepEqual(manifest.sources, { papers: snapshot.sources.papers, signals: signalSource });
assert.equal(snapshot.sources.papers.manifestSha256, hash(paperManifestBytes));
assert.equal(snapshot.sources.signals.manifestSha256, hash(signalManifestBytes));
assert.equal(snapshot.sources.papers.totalStored, papers.papers.length);
assert.equal(snapshot.sources.papers.totalStored, paperManifest.totalStored);
assert.equal(snapshot.sources.papers.collectedAt, papers.collectedAt);
assert.equal(snapshot.sources.signals.totalStored, signals.records.length);
assert.equal(snapshot.sources.signals.totalStored, signalManifest.counts.github + signalManifest.counts.news);
assert.equal(snapshot.sources.signals.generatedAt, signals.generatedAt);
assert.equal(snapshot.sources.signals.generatedAt, signalManifest.generatedAt);
assert.deepEqual(snapshot.sources.signals.states, signals.sources);
assert.deepEqual(snapshot.sources.signals.states, signalManifest.sources);
assert.equal(deployment.analysisSnapshotSha256, hash(summaryBytes));
assert.equal(deployment.analysisManifestSha256, hash(analysisManifestBytes));
assert.equal(deployment.compactPapersSha256, hash(paperManifestBytes));
assert.equal(deployment.signalsManifestSha256, hash(signalManifestBytes));
const directResult = analyzeResearch({
  papers: papers.papers,
  signals: signals.records,
  asOf: snapshot.result.asOf,
});
assert.deepEqual(
  snapshot.result,
  directResult,
  "Published calculation differs from the unchanged rule engine on complete source archives",
);
const previousBytes =
  paperManifestBytes.length +
  signalManifestBytes.length +
  [...paperManifest.shards, ...signalManifest.shards].reduce((total, shard) => total + shard.bytes, 0);
const previousRequests = 2 + paperManifest.shards.length + signalManifest.shards.length;
const newBytes = bootstrapBytes.length + analysisManifestBytes.length;
const compactBytes = bootstrapV2Bytes.length + manifestV2Bytes.length;
const gzipBytes = gzipSync(bootstrapBytes, { level: 9 }).length;
const compactGzipBytes = gzipSync(bootstrapV2Bytes, { level: 9 }).length;
const report = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  evidence: "Complete real source archives; no synthetic fixtures or language models",
  sourceFiles: ["data/papers.json", "data/research-signals.json"],
  generatedAt: snapshot.generatedAt,
  asOf: snapshot.result.asOf,
  ruleVersion: snapshot.result.version,
  sourceCounts: { papers: papers.papers.length, signals: signals.records.length },
  analysisCounts: {
    historicalUniquePapers: snapshot.result.historyTotal,
    windowTotals: snapshot.result.totals,
    directions: snapshot.result.directions.length,
    nicheCandidates: snapshot.result.niches.length,
  },
  checks: {
    fullResultDeepEqual: true,
    compactFullSnapshotDeepEqual: true,
    compactBootstrapSummaryBytesIdentical: true,
    compactWebDataManifestsIdentical: true,
    compactPhysicalAndContentFingerprintsVerified: true,
    equivalenceCoverage:
      "All totals, exclusions, duplicates, direction ordering, shares, scores, facets, niche candidates, statuses, gaps and source evidence",
    bootstrapSummaryBytesIdentical: true,
    manifestBytesAndSha256Verified: true,
    sourceManifestHashesVerified: true,
    sourceCountsTimesAndStatesVerified: true,
    deploymentHashesVerified: true,
  },
  transport: {
    measurement:
      "Uncompressed file bytes and data request counts only; excludes application assets and HTTP headers. This is not a network latency measurement.",
    previousFullData: {
      requests: previousRequests,
      rawBytes: previousBytes,
      paperShards: paperManifest.shards.length,
      signalShards: signalManifest.shards.length,
    },
    compactSameContent: {
      requests: 2,
      rawBytes: compactBytes,
      snapshotRawBytes: bootstrapV2Bytes.length,
      snapshotGzipBytes: compactGzipBytes,
      manifestRawBytes: manifestV2Bytes.length,
      note: "One compact payload and one data manifest; unchanged content with different build timestamps or source shard hashes does not require a second payload.",
      rawReductionVsV1Percent: Number(
        ((1 - bootstrapV2Bytes.length / bootstrapBytes.length) * 100).toFixed(2),
      ),
      gzipReductionVsV1Percent: Number(((1 - compactGzipBytes / gzipBytes) * 100).toFixed(2)),
    },
    sameGeneration: {
      requests: 2,
      rawBytes: newBytes,
      snapshotRawBytes: bootstrapBytes.length,
      manifestRawBytes: analysisManifestBytes.length,
      snapshotGzipBytes: gzipSync(bootstrapBytes, { level: 9 }).length,
    },
    refreshOrSlowBootstrap: {
      requests: 3,
      note: "A differing remote manifest or a slow web bootstrap can add one verified summary transfer; deployment races can require one bounded retry. The two-request case is the healthy same-generation path, observed separately in the local browser report.",
    },
    rawBytesReductionPercent: Number(((1 - newBytes / previousBytes) * 100).toFixed(2)),
  },
  fingerprints: {
    analysisSummary: hash(summaryBytes),
    compactAnalysisSummary: hash(summaryV2Bytes),
    analysisContent: manifestV2.contentSha256,
    paperManifest: hash(paperManifestBytes),
    signalManifest: hash(signalManifestBytes),
  },
};
await mkdir("docs", { recursive: true });
await writeFile("docs/analysis-publication-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

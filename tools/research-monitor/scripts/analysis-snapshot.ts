import { createHash } from "node:crypto";
import { analyzeResearch } from "../lib/integrated-analysis";
import {
  ANALYSIS_SNAPSHOT_SCHEMA,
  ANALYSIS_MANIFEST_SCHEMA,
  parseAnalysisSnapshot,
  parseAnalysisManifest,
  type AnalysisSnapshot,
  type AnalysisManifest,
} from "../lib/analysis-snapshot";
import type { VerifiedPublicData } from "../lib/public-data-schema";
import type { ResearchSignalsData } from "../lib/research-signals";

/** Run the unchanged algorithm once per publication, at an explicit UTC reference date. */
export function createAnalysisSnapshot(input: {
  papers: VerifiedPublicData;
  signals: ResearchSignalsData;
  paperManifestSha256: string;
  signalsManifestSha256: string;
  generatedAt: string;
}): AnalysisSnapshot {
  const { papers, signals, generatedAt } = input;
  const asOf = new Date(generatedAt).toISOString().slice(0, 10);
  return parseAnalysisSnapshot({
    schema: ANALYSIS_SNAPSHOT_SCHEMA,
    generatedAt,
    sources: {
      papers: {
        collectedAt: papers.collectedAt,
        totalStored: papers.papers.length,
        manifestSha256: input.paperManifestSha256,
      },
      signals: {
        generatedAt: signals.generatedAt,
        totalStored: signals.records.length,
        manifestSha256: input.signalsManifestSha256,
        states: signals.sources,
      },
    },
    result: analyzeResearch({ papers: papers.papers, signals: signals.records, asOf }),
  });
}

/** Manifest hashes the exact bytes written to both publication endpoints. */
export function createAnalysisManifest(snapshot: AnalysisSnapshot, snapshotText: string): AnalysisManifest {
  const { states: _states, ...signals } = snapshot.sources.signals;
  return parseAnalysisManifest({
    schema: ANALYSIS_MANIFEST_SCHEMA,
    generatedAt: snapshot.generatedAt,
    asOf: snapshot.result.asOf,
    ruleVersion: snapshot.result.version,
    snapshotSha256: createHash("sha256").update(snapshotText).digest("hex"),
    snapshotBytes: Buffer.byteLength(snapshotText),
    sources: { papers: snapshot.sources.papers, signals },
  });
}

import { createHash } from "node:crypto";
import type { AnalysisSnapshot } from "../lib/analysis-snapshot";
import { createAnalysisManifest } from "./analysis-snapshot";
import {
  ANALYSIS_MANIFEST_V2_SCHEMA,
  parseAnalysisManifestV2,
  stableAnalysisContent,
  type AnalysisManifestV2,
} from "../lib/analysis-transport";

/** Physical byte integrity and semantic calculation identity remain separate. */
export function createAnalysisManifestV2(snapshot: AnalysisSnapshot, serialized: string): AnalysisManifestV2 {
  const legacy = createAnalysisManifest(snapshot, serialized);
  return parseAnalysisManifestV2({
    ...legacy,
    schema: ANALYSIS_MANIFEST_V2_SCHEMA,
    contentSha256: createHash("sha256").update(stableAnalysisContent(snapshot)).digest("hex"),
  });
}

import { createAnalysisManifest, createAnalysisSnapshot } from "./analysis-snapshot";
import { encodeAnalysisTransport } from "../lib/analysis-transport";
import { createAnalysisManifestV2 } from "./analysis-transport";
import { createPaperOverview } from "./paper-overview";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readSnapshotFile } from "./snapshot-files";
import { monitorDataSchema } from "../lib/local-api";
import { writePublicSnapshotV3 } from "./public-snapshot";
import { readSignalArchiveFile } from "./signal-archive";
import { writeSignalsSnapshot, readSignalsSnapshot } from "./signals-snapshot";
import { checkPublicationSize, prunePublishedShards } from "./publication-retention";

// The modern data site has its own current/preceding generations. Legacy URLs
// remain a dated migration snapshot on the web site; never duplicate them here.
const previous = process.env.MONITOR_PREVIOUS_DATA_DIR ?? "../../research-monitor/data";
const data = await readSnapshotFile("data/papers.json");
monitorDataSchema.parse(data);
const compact = await writePublicSnapshotV3(
  "dist/data/public-papers-v3.json",
  data,
  join(previous, "public-papers-v3.json"),
);
assert.deepEqual(await readSnapshotFile("dist/data/public-papers-v3.json"), data);
await writeFile("dist/data/paper-overview.json", JSON.stringify(createPaperOverview(data)));
const signals = await readSignalArchiveFile("data/research-signals.json");
await writeSignalsSnapshot(
  "dist/data/signals-v2/manifest.json",
  signals,
  join(previous, "signals-v2/manifest.json"),
);
assert.deepEqual(await readSignalsSnapshot("dist/data/signals-v2/manifest.json"), {
  ...signals,
  records: [...signals.records].sort((a, b) => a.id.localeCompare(b.id)),
});
const retention = await prunePublishedShards("dist/data", previous, ["public-papers-v3.json"]);
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const compactPapersSha256 = await hash("dist/data/public-papers-v3.json");
const signalsManifestSha256 = await hash("dist/data/signals-v2/manifest.json");
const analysis = createAnalysisSnapshot({
  papers: data,
  signals,
  paperManifestSha256: compactPapersSha256,
  signalsManifestSha256,
  generatedAt: new Date().toISOString(),
});
const analysisText = JSON.stringify(analysis) + "\n";
const analysisManifest = createAnalysisManifest(analysis, analysisText);
await writeFile("dist/data/analysis-summary.json", analysisText);
await writeFile("dist/data/analysis-manifest.json", JSON.stringify(analysisManifest) + "\n");
// Root-level bootstrap belongs to this web build while the independent data site catches up.
await writeFile("dist/analysis-bootstrap.json", analysisText);
const analysisV2Text = JSON.stringify(encodeAnalysisTransport(analysis)) + "\n";
const analysisV2Manifest = createAnalysisManifestV2(analysis, analysisV2Text);
const analysisV2ManifestText = JSON.stringify(analysisV2Manifest) + "\n";
await writeFile("dist/data/analysis-summary-v2.json", analysisV2Text);
await writeFile("dist/data/analysis-manifest-v2.json", analysisV2ManifestText);
await writeFile("dist/analysis-bootstrap-v2.json", analysisV2Text);
await writeFile("dist/analysis-bootstrap-manifest-v2.json", analysisV2ManifestText);
const publication = await checkPublicationSize("dist");
await writeFile(
  "dist/deployment.json",
  JSON.stringify(
    {
      schemaVersion: 2,
      sourceRevision: process.env.MONITOR_SOURCE_REVISION ?? "local",
      runId: process.env.GITHUB_RUN_ID ?? "local",
      paperCount: compact.totalStored,
      signalCount: signals.records.length,
      collectedAt: data.collectedAt,
      signalsGeneratedAt: signals.generatedAt,
      compactPapersSha256,
      paperOverviewSha256: await hash("dist/data/paper-overview.json"),
      signalsManifestSha256,
      analysisSnapshotSha256: analysisManifest.snapshotSha256,
      analysisManifestSha256: await hash("dist/data/analysis-manifest.json"),
      analysisSnapshotV2Sha256: analysisV2Manifest.snapshotSha256,
      analysisManifestV2Sha256: await hash("dist/data/analysis-manifest-v2.json"),
      analysisContentSha256: analysisV2Manifest.contentSha256,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified modern publication: ${compact.totalStored} papers and ${signals.records.length} signals; ${publication.bytes} bytes; retained ${retention.retained} shards`,
);

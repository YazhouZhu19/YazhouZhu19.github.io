import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readSnapshotFile } from "./snapshot-files";
import { monitorDataSchema } from "../lib/local-api";
import { writePublicSnapshotV3 } from "./public-snapshot";
import { parseResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";
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
const signalBytes = await readFile("data/research-signals.json");
assert.ok(signalBytes.length <= SIGNALS_MAX_BYTES, "Signal snapshot exceeds publication limit");
const signals = parseResearchSignalsData(JSON.parse(signalBytes.toString("utf8")));
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
const publication = await checkPublicationSize("dist");
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
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
      compactPapersSha256: await hash("dist/data/public-papers-v3.json"),
      signalsManifestSha256: await hash("dist/data/signals-v2/manifest.json"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified modern publication: ${compact.totalStored} papers and ${signals.records.length} signals; ${publication.bytes} bytes; retained ${retention.retained} shards`,
);

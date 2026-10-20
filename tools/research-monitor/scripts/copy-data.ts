import { readSnapshotFile } from "./snapshot-files";
import { monitorDataSchema } from "../lib/local-api";
import { writePublicSnapshot, writePublicSnapshotV3 } from "./public-snapshot";
import { copyPreviousSnapshotShards } from "./snapshot-install";
import { parseResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";
import { writeSignalsSnapshot } from "./signals-snapshot";
import { checkPublicationSize, prunePublishedShards } from "./publication-retention";

// Verify the complete source snapshot before publishing any data.
const data = await readSnapshotFile("data/papers.json");
monitorDataSchema.parse(data);
const manifest = await writePublicSnapshot("dist/data/public-papers-v2.json", data, "../../research-monitor/data/public-papers-v2.json");
const compact = await writePublicSnapshotV3("dist/data/public-papers-v3.json", data, "../../research-monitor/data/public-papers-v3.json");
// Each writer protects current sibling manifests; restore both previous public
// generations after all writers finish, for clients crossing the deployment.
for (const version of [2, 3]) await copyPreviousSnapshotShards(`../../research-monitor/data/public-papers-v${version}.json`, "dist/data");
// Cached v1 bundles keep polling this original URL. Preserve the full v1
// manifest and both archive generations after the public writer has pruned.
for (const name of await readdir("data/papers")) {
  if (/^[a-f0-9]{64}\.json$/.test(name)) await copyFile(`data/papers/${name}`, `dist/data/papers/${name}`);
}
await copyFile("data/papers.json", "dist/data/papers.json");
assert.deepEqual(await readSnapshotFile("dist/data/papers.json"), data);
assert.deepEqual(await readSnapshotFile("dist/data/public-papers-v2.json"), data);
assert.deepEqual(await readSnapshotFile("dist/data/public-papers-v3.json"), data);
console.log(`Verified lossless public v3 snapshot: ${compact.totalStored} papers, ${compact.shards.length} shards, ${compact.queryUrls?.length ?? 0} shared query URLs, ${compact.affiliations?.length ?? 0} shared affiliations; v1 and v2 (${manifest.shards.length} shards) retained`);
const signalBytes = await readFile("data/research-signals.json");
assert.ok(signalBytes.length <= SIGNALS_MAX_BYTES, "Signal snapshot exceeds publication limit");
const signals = parseResearchSignalsData(JSON.parse(signalBytes.toString("utf8")));
await copyFile("data/research-signals.json", "dist/data/research-signals.json");
assert.deepEqual(await readFile("dist/data/research-signals.json"), signalBytes);
console.log(`Verified public signal snapshot: ${signals.records.length} GitHub and news records`);
const signalManifest = await writeSignalsSnapshot("dist/data/signals-v2/manifest.json", signals,
  "../../research-monitor/data/signals-v2/manifest.json");
console.log(`Verified sharded signals: ${signalManifest.shards.length} shards; overview metadata loads independently of records`);
const retention = await prunePublishedShards("dist/data", "../../research-monitor/data");
const publication = await checkPublicationSize("dist");
console.log(`Publication budget: ${publication.bytes} / 800000000 bytes; kept ${retention.retained} referenced shards and removed ${retention.removed.length} orphans (${retention.removedBytes} bytes)`);
import assert from "node:assert/strict";
import { copyFile, readFile, readdir } from "node:fs/promises";

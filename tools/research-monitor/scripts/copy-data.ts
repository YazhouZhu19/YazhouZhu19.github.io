import { readSnapshotFile } from "./snapshot-files";
import { monitorDataSchema } from "../lib/local-api";
import { writePublicSnapshot } from "./public-snapshot";

// Verify the complete source snapshot before publishing any data.
const data = await readSnapshotFile("data/papers.json");
monitorDataSchema.parse(data);
const manifest = await writePublicSnapshot("dist/data/public-papers-v2.json", data, "../../research-monitor/data/public-papers-v2.json");
// Cached v1 bundles keep polling this original URL. Preserve the full v1
// manifest and both archive generations after the public writer has pruned.
for (const name of await readdir("data/papers")) {
  if (/^[a-f0-9]{64}\.json$/.test(name)) await copyFile(`data/papers/${name}`, `dist/data/papers/${name}`);
}
await copyFile("data/papers.json", "dist/data/papers.json");
assert.deepEqual(await readSnapshotFile("dist/data/papers.json"), data);
assert.deepEqual(await readSnapshotFile("dist/data/public-papers-v2.json"), data);
console.log(`Verified lossless public snapshot: ${manifest.totalStored} papers, ${manifest.shards.length} shards, ${manifest.queryUrls?.length ?? 0} shared query URLs; v1 endpoint retained`);
import assert from "node:assert/strict";
import { copyFile, readdir } from "node:fs/promises";

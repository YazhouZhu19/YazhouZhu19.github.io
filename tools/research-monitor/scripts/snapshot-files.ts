import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_SHARD_BYTES, SNAPSHOT_SCHEMA, resolveSnapshot, type SnapshotManifest } from "../lib/snapshot";
import { createSnapshotShards } from "./snapshot-buckets";
import { installSnapshot } from "./snapshot-install";

export async function readSnapshotFile(file: string) {
  return resolveSnapshot(JSON.parse(await readFile(file, "utf8")), (path) =>
    readFile(join(dirname(file), path), "utf8"),
  );
}

/** Keep every field and paper. Install immutable shards before replacing the manifest. */
export async function writeSnapshotFile(
  file: string,
  data: { papers: { id: string; publishedAt?: unknown }[]; collectedAt?: unknown },
  maxBytes = MAX_SHARD_BYTES,
  asOf = data.collectedAt,
) {
  const { texts, shards } = createSnapshotShards(data, maxBytes, asOf);
  const { papers, ...rest } = data;
  const metadata: Record<string, unknown> = { ...rest, totalStored: papers.length };
  const manifest: SnapshotManifest = {
    schema: SNAPSHOT_SCHEMA,
    metadata,
    totalStored: papers.length,
    shards,
  };
  await installSnapshot(file, manifest, texts);
  return manifest;
}

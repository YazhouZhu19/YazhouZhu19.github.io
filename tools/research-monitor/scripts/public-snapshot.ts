import assert from "node:assert/strict";
import { resolve } from "node:path";
import { MAX_SHARD_BYTES, PUBLIC_SNAPSHOT_SCHEMA, SNAPSHOT_SCHEMA, compareSnapshotPapers, parseSnapshotManifest, type SnapshotManifest } from "../lib/snapshot";
import { readSnapshotFile } from "./snapshot-files";
import { createSnapshotShards } from "./snapshot-buckets";
import { installSnapshot, readSnapshotManifest } from "./snapshot-install";

/** Public transport only: archive records and every provenance entry stay intact. */
export async function writePublicSnapshot(file: string, data: { papers: any[]; collectedAt?: unknown }, previousFile?: string, maxBytes = MAX_SHARD_BYTES, asOf = data.collectedAt) {
  const currentManifest = await readSnapshotManifest(file);
  const previousManifest = previousFile && resolve(previousFile) !== resolve(file) ? await readSnapshotManifest(previousFile) : undefined;
  const urls = new Set<string>();
  for (const paper of data.papers) for (const item of paper.provenance) {
    if ("queryUrl" in item) {
      if (typeof item.queryUrl !== "string") throw new Error("Invalid source query URL");
      urls.add(item.queryUrl);
    }
  }
  // Keep published indices stable: a new URL must not renumber every old month.
  const queryUrls = [...(currentManifest?.queryUrls ?? previousManifest?.queryUrls ?? [])];
  const known = new Set(queryUrls);
  for (const url of [...urls].sort()) if (!known.has(url)) queryUrls.push(url);
  const indices = new Map(queryUrls.map((url, index) => [url, index]));
  const papers = data.papers.map(paper => ({ ...paper, provenance: paper.provenance.map((item: any) =>
    "queryUrl" in item ? { ...item, queryUrl: indices.get(item.queryUrl)! } : item) }));
  let encoded = createSnapshotShards({ ...data, papers }, maxBytes, asOf);
  const { papers: originalPapers, ...rest } = data;
  const metadata = { ...rest, totalStored: originalPapers.length };
  let manifest: SnapshotManifest = { schema: PUBLIC_SNAPSHOT_SCHEMA, metadata, totalStored: originalPapers.length, shards: encoded.shards, queryUrls };
  parseSnapshotManifest(manifest);
  const text = JSON.stringify(manifest) + "\n";
  if (Buffer.byteLength(text) > MAX_SHARD_BYTES) {
    // Historical URLs can outgrow the dictionary budget. The versioned client
    // also understands v1, so publish the complete archive representation
    // instead of failing an otherwise valid collection or dropping history.
    encoded = createSnapshotShards(data, maxBytes, asOf);
    manifest = { schema: SNAPSHOT_SCHEMA, metadata, totalStored: originalPapers.length, shards: encoded.shards };
  }
  await installSnapshot(file, manifest, encoded.texts,
    previousManifest && previousFile ? { file: previousFile, manifest: previousManifest } : undefined);
  // Compare original objects, never a Zod projection that could discard fields.
  assert.deepEqual(await readSnapshotFile(file), { ...data, totalStored: originalPapers.length, papers: [...originalPapers].sort(compareSnapshotPapers) },
    "Public snapshot changed collected records or metadata");
  return manifest;
}

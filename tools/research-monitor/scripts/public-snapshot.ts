import assert from "node:assert/strict";
import { resolve } from "node:path";
import { MAX_SHARD_BYTES, PUBLIC_SNAPSHOT_SCHEMA, PUBLIC_SNAPSHOT_V3_SCHEMA, SNAPSHOT_SCHEMA, compareSnapshotPapers, parseSnapshotManifest, type SnapshotManifest } from "../lib/snapshot";
import { encodeV3Paper } from "../lib/snapshot-v3";
import { readSnapshotFile } from "./snapshot-files";
import { createSnapshotShards } from "./snapshot-buckets";
import { installSnapshot, readSnapshotManifest } from "./snapshot-install";

/** Public transport only: archive records and every provenance entry stay intact. */
export async function writePublicSnapshot(file: string, data: { papers: any[]; collectedAt?: unknown }, previousFile?: string, maxBytes = MAX_SHARD_BYTES, asOf = data.collectedAt) {
  return writePublicFormat(file, data, PUBLIC_SNAPSHOT_SCHEMA, previousFile, maxBytes, asOf);
}

export async function writePublicSnapshotV3(file: string, data: { papers: any[]; collectedAt?: unknown }, previousFile?: string, maxBytes = MAX_SHARD_BYTES, asOf = data.collectedAt) {
  return writePublicFormat(file, data, PUBLIC_SNAPSHOT_V3_SCHEMA, previousFile, maxBytes, asOf);
}

/** Prefer repeated institutions with net savings; remaining text stays literal. */
function extendAffiliations(papers: any[], previous: string[], availableBytes: number) {
  const dictionary = [...previous], known = new Set(dictionary), counts = new Map<string, number>();
  const add = (values: unknown) => {
    if (!Array.isArray(values)) return;
    for (const value of values) if (typeof value === "string" && !known.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  };
  for (const paper of papers) {
    add(paper.affiliations);
    for (const author of paper.authors ?? []) add(author.affiliations);
  }
  const referenceBytes = String(dictionary.length + counts.size).length;
  const candidates = [...counts].map(([value, count]) => {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    return { value, bytes, savings: count * (bytes - referenceBytes) - bytes - 1, count };
  }).filter(value => value.count > 1 && value.savings > 0)
    .sort((a, b) => b.savings - a.savings || a.value.localeCompare(b.value));
  for (const { value, bytes } of candidates) {
    const needed = bytes + (dictionary.length ? 1 : 0);
    if (needed > availableBytes) continue;
    dictionary.push(value); availableBytes -= needed;
  }
  return dictionary;
}

async function writePublicFormat(file: string, data: { papers: any[]; collectedAt?: unknown },
  schema: typeof PUBLIC_SNAPSHOT_SCHEMA | typeof PUBLIC_SNAPSHOT_V3_SCHEMA, previousFile?: string, maxBytes = MAX_SHARD_BYTES, asOf = data.collectedAt) {
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
  const { papers: originalPapers, ...rest } = data;
  const metadata = { ...rest, totalStored: originalPapers.length };
  let encoded = createSnapshotShards({ ...data, papers }, maxBytes, asOf);
  let manifest: SnapshotManifest = { schema: PUBLIC_SNAPSHOT_SCHEMA, metadata, totalStored: originalPapers.length, shards: encoded.shards, queryUrls };
  if (schema === PUBLIC_SNAPSHOT_V3_SCHEMA) {
    const previousAffiliations = currentManifest?.affiliations ?? previousManifest?.affiliations ?? [];
    const provisional = { ...manifest, schema, affiliations: previousAffiliations };
    // Leave descriptor headroom: institutions may reduce but never justify
    // exceeding the same 4 MiB manifest and shard safety limits.
    const available = MAX_SHARD_BYTES - Buffer.byteLength(JSON.stringify(provisional) + "\n") - 256 * 1024 - 512 * (encoded.shards.length + 1);
    const affiliations = extendAffiliations(papers, previousAffiliations, available);
    const indices = new Map(affiliations.map((value, index) => [value, index]));
    encoded = createSnapshotShards({ ...data, papers }, maxBytes, asOf, paper => encodeV3Paper(paper, indices));
    manifest = { ...manifest, schema, affiliations, shards: encoded.shards };
    if (Buffer.byteLength(JSON.stringify(manifest) + "\n") > MAX_SHARD_BYTES) {
      // An existing dictionary may outgrow its remaining budget as metadata
      // grows. A v2 payload at this endpoint is still lossless and supported.
      encoded = createSnapshotShards({ ...data, papers }, maxBytes, asOf);
      manifest = { schema: PUBLIC_SNAPSHOT_SCHEMA, metadata, totalStored: originalPapers.length, shards: encoded.shards, queryUrls };
    }
  }
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

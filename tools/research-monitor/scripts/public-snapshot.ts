import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MAX_SHARD_BYTES, PUBLIC_SNAPSHOT_SCHEMA, parseSnapshotManifest, type SnapshotManifest } from "../lib/snapshot";
import { readSnapshotFile, writeSnapshotFile } from "./snapshot-files";

/** Public transport only: archive records and every provenance entry stay intact. */
export async function writePublicSnapshot(file: string, data: { papers: any[] }, previousFile?: string, maxBytes = MAX_SHARD_BYTES) {
  const urls = new Set<string>();
  for (const paper of data.papers) for (const item of paper.provenance) {
    if ("queryUrl" in item) {
      if (typeof item.queryUrl !== "string") throw new Error("Invalid source query URL");
      urls.add(item.queryUrl);
    }
  }
  const queryUrls = [...urls].sort();
  const indices = new Map(queryUrls.map((url, index) => [url, index]));
  const papers = data.papers.map(paper => ({ ...paper, provenance: paper.provenance.map((item: any) =>
    "queryUrl" in item ? { ...item, queryUrl: indices.get(item.queryUrl)! } : item) }));
  await mkdir(join(dirname(file), "papers"), { recursive: true });
  // Read the previous published generation before creating the new one.
  let previousManifest: SnapshotManifest | undefined;
  if (previousFile && resolve(previousFile) !== resolve(file)) {
    let previousBytes: Buffer | undefined;
    try { previousBytes = await readFile(previousFile); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    if (previousBytes) {
      const previous = JSON.parse(previousBytes.toString());
      if (previous?.schema) {
        previousManifest = parseSnapshotManifest(previous);
      }
    }
  }
  const encoded = await writeSnapshotFile(file, { ...data, papers }, maxBytes);
  let manifest: SnapshotManifest = { ...encoded, schema: PUBLIC_SNAPSHOT_SCHEMA, queryUrls };
  parseSnapshotManifest(manifest);
  const text = JSON.stringify(manifest) + "\n";
  if (Buffer.byteLength(text) > MAX_SHARD_BYTES) {
    // Historical URLs can outgrow the dictionary budget. The versioned client
    // also understands v1, so publish the complete archive representation
    // instead of failing an otherwise valid collection or dropping history.
    manifest = await writeSnapshotFile(file, data, maxBytes);
  } else {
    const temporary = file + ".public.tmp";
    await writeFile(temporary, text);
    await rename(temporary, file);
  }
  // Cached clients need the previous immutable shards and their own dictionary.
  // Copy after writing: the archive writer prunes unreferenced output shards.
  if (previousManifest && previousFile) for (const shard of previousManifest.shards) {
    await copyFile(join(dirname(previousFile), shard.path), join(dirname(file), shard.path));
  }
  // Compare original objects, never a Zod projection that could discard fields.
  assert.deepEqual(await readSnapshotFile(file), data, "Public snapshot changed collected records or metadata");
  return manifest;
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { MAX_SHARD_BYTES, parseSnapshotManifest, resolveSnapshot } from "../lib/snapshot";
import { readSnapshotFile, writeSnapshotFile } from "../scripts/snapshot-files";

function library(prefix = "p") {
  return { papers: Array.from({ length: 9 }, (_, i) => ({ id: `${prefix}${i}`, abstract: "医学影像".repeat(12), originalAbstract: `<p>${i}</p>`, provenance: [{ collectedAt: "2026-10-04T00:00:00Z" }] })),
    totalStored: 9, collectedAt: "2026-10-04T00:00:00Z", customMetadata: { retained: true } };
}

test("legacy migration round-trips all paper fields, Unicode, order and metadata within the byte cap", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json"), before = library();
  await writeFile(file, JSON.stringify(before, null, 2));
  assert.deepEqual(await readSnapshotFile(file), before);
  const manifest = await writeSnapshotFile(file, before, 600);
  assert.ok(manifest.shards.length > 1);
  for (const shard of manifest.shards) {
    const bytes = await readFile(join(dir, shard.path));
    assert.ok(bytes.length <= 600);
    assert.equal(shard.bytes, bytes.length);
    assert.equal(shard.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  assert.deepEqual(await readSnapshotFile(file), before);
  const again = await writeSnapshotFile(file, before, 600);
  assert.deepEqual(again, manifest);
});

test("oversized records or duplicate IDs fail before replacing a valid snapshot", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json"), before = library();
  await writeSnapshotFile(file, before, 600);
  const manifest = await readFile(file, "utf8");
  await assert.rejects(writeSnapshotFile(file, { papers: [{ id: "huge", abstract: "x".repeat(601) }] } as any, 600), /exceeds/);
  await assert.rejects(writeSnapshotFile(file, { papers: [before.papers[0], before.papers[0]] }, 600), /duplicate/);
  assert.equal(await readFile(file, "utf8"), manifest);
  assert.deepEqual(await readSnapshotFile(file), before);
});

test("retains exactly the previous generation for cached clients, then prunes obsolete shards", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json");
  const first = await writeSnapshotFile(file, library("a"), 600);
  const second = await writeSnapshotFile(file, library("b"), 600);
  assert.deepEqual(await resolveSnapshot(first, path => readFile(join(dir, path), "utf8")), library("a"));
  const third = await writeSnapshotFile(file, library("c"), 600);
  assert.deepEqual((await readdir(join(dir, "papers"))).sort(), [...second.shards, ...third.shards].map(s => s.path.split("/")[1]).sort());
  assert.deepEqual(await readSnapshotFile(file), library("c"));
});

test("missing or same-size corrupted shards reject the complete snapshot", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json");
  const manifest = await writeSnapshotFile(file, library(), 600);
  const shardFile = join(dir, manifest.shards[0].path);
  const original = await readFile(shardFile, "utf8");
  await writeFile(shardFile, original.replace('"p0"', '"q0"'));
  await assert.rejects(readSnapshotFile(file), /checksum/);
  await rm(shardFile);
  await assert.rejects(readSnapshotFile(file), /ENOENT/);
});

test("writing another output manifest in the same directory never prunes the input library", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "papers.json"), output = join(dir, "preview.json");
  await writeSnapshotFile(source, library("source"), 600);
  await writeSnapshotFile(output, library("preview"), 600);
  await writeSnapshotFile(output, library("preview-next"), 600);
  assert.deepEqual(await readSnapshotFile(source), library("source"));
  assert.deepEqual(await readSnapshotFile(output), library("preview-next"));
});

test("manifest validation rejects unsafe paths, incorrect totals and oversized shard declarations", () => {
  const digest = "a".repeat(64);
  const manifest = { schema: "research-monitor-shards-v1", totalStored: 1, metadata: { totalStored: 1 },
    shards: [{ path: `papers/${digest}.json`, sha256: digest, count: 1, bytes: 100 }] };
  assert.doesNotThrow(() => parseSnapshotManifest(manifest));
  for (const patch of [{ path: "../secret.json" }, { bytes: MAX_SHARD_BYTES + 1 }, { count: 2 }, { sha256: "b".repeat(64) }]) {
    assert.throws(() => parseSnapshotManifest({ ...manifest, shards: [{ ...manifest.shards[0], ...patch }] }));
  }
  assert.throws(() => parseSnapshotManifest({ ...manifest, shards: [...manifest.shards, ...manifest.shards] }));
});

test("empty libraries remain valid and do not request shards", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-shards-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const empty = { ...library(), papers: [], totalStored: 0 };
  const manifest = await writeSnapshotFile(join(dir, "papers.json"), empty);
  assert.deepEqual(manifest.shards, []);
  assert.deepEqual(await resolveSnapshot(manifest, async () => { throw new Error("must not fetch"); }), empty);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compactArchive } from "../scripts/compact-archive";
import { readSnapshotFile, writeSnapshotFile } from "../scripts/snapshot-files";
import { SNAPSHOT_SCHEMA, resolveSnapshot } from "../lib/snapshot";
import { writePublicSnapshotV3 } from "../scripts/public-snapshot";

const library = (id: string) => ({
  totalStored: 12,
  customMetadata: { exact: "原始证据 ✓" },
  papers: Array.from({ length: 12 }, (_, i) => ({
    id: `${id}:${String(i).padStart(2, "0")}`,
    publishedAt: "2026-10-01",
    abstract: "Full abstract",
    authors: [],
    originalAbstract: "<p>Original</p>",
    extra: { nested: [false, null, i] },
    provenance: [{ queryUrl: `https://example.org/?q=${"long-query".repeat(40)}`, extra: i }],
  })),
});

test("archive compaction preserves every field, prunes only unreferenced internal shards and is idempotent", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "compact-archive-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "archive", "papers.json");
  await writeSnapshotFile(file, library("old"));
  await writeSnapshotFile(file, library("current"));
  const sibling = join(dir, "archive", "kept.json");
  await writeSnapshotFile(sibling, library("sibling"));
  await writeFile(join(dir, "archive", "papers", "README.txt"), "keep");
  const before = await readSnapshotFile(file);
  const result = await compactArchive(file);
  assert.ok(result.removedBytes > 0);
  assert.deepEqual(await readSnapshotFile(file), before);
  assert.deepEqual(await readSnapshotFile(sibling), library("sibling"));
  assert.equal(await readFile(join(dir, "archive", "papers", "README.txt"), "utf8"), "keep");
  assert.equal((await compactArchive(file)).removedBytes, 0);
  // Cached v1 clients still get v1 even when the internal archive is compact.
  const legacyFile = join(dir, "public", "papers.json");
  const legacy = await writeSnapshotFile(legacyFile, await readSnapshotFile(file));
  assert.equal(legacy.schema, SNAPSHOT_SCHEMA);
  assert.deepEqual(await resolveSnapshot(legacy, (p) => readFile(join(dir, "public", p), "utf8")), before);
});

test("corrupt archive data is rejected before any compaction or cleanup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "compact-corrupt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json");
  const manifest = await writeSnapshotFile(file, library("broken"));
  await writeFile(join(dir, manifest.shards[0].path), "[]");
  const before = await readFile(file);
  const names = await readdir(join(dir, "papers"));
  await assert.rejects(compactArchive(file));
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readdir(join(dir, "papers")), names);
});

test("collection through v1 preserves prior public dictionary indices during internal compaction", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "compact-stable-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "archive", "papers.json");
  const previous = join(dir, "published", "public-papers-v3.json");
  const original = library("stable");
  const oldManifest = await writePublicSnapshotV3(previous, original);
  const next = structuredClone(original);
  next.papers.push({
    ...next.papers[0],
    id: "new",
    provenance: [{ queryUrl: "https://aaa.org/earlier", extra: 99 }],
  });
  next.totalStored++;
  await writeSnapshotFile(file, next);
  const expected = await readSnapshotFile(file);
  await compactArchive(file, previous);
  const current = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(current.queryUrls.slice(0, oldManifest.queryUrls!.length), oldManifest.queryUrls);
  assert.deepEqual(await readSnapshotFile(file), expected);
  assert.deepEqual(await readSnapshotFile(previous), original);
});

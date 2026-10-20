import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSnapshotShards, snapshotBucket } from "../scripts/snapshot-buckets";
import { readSnapshotFile, writeSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot } from "../scripts/public-snapshot";
import {
  compareSnapshotPapers,
  parseSnapshotManifest,
  resolveSnapshot,
  type SnapshotManifest,
} from "../lib/snapshot";

const asOf = "2026-10-20T12:00:00Z";
const paper = (id: string, publishedAt: string) => ({
  id,
  publishedAt,
  abstract: `原文 ${id}`,
  provenance: [],
});
const library = () => ({
  collectedAt: asOf,
  papers: [
    paper("sept-b", "2026-09-20"),
    paper("oct-b", "2026-10-19"),
    paper("aug-a", "2026-08-01"),
    paper("sept-a", "2026-09-01"),
    paper("oct-a", "2026-10-18"),
    paper("future", "2026-12-01"),
  ],
});

test("month buckets validate dates against the snapshot timestamp, never the build clock", () => {
  for (const date of [
    null,
    "",
    "not-a-date",
    "2026-02-30",
    "2026-13-01",
    "2026-10-21",
    "2026-10-20T13:00:00Z",
  ]) {
    assert.equal(snapshotBucket(date, asOf), "undated");
  }
  assert.equal(snapshotBucket("2026-10-20", asOf), "2026-10");
  assert.equal(snapshotBucket("2024-02-29", asOf), "2024-02");
  assert.equal(snapshotBucket("2026-10-20"), "undated");
});

test("adding current-month records leaves every other month's encoded bytes and hash unchanged", () => {
  const source = library(),
    original = structuredClone(source);
  const before = createSnapshotShards(source);
  const added = Array.from({ length: 5 }, (_, i) => paper(`oct-new-${i}`, "2026-10-20"));
  const after = createSnapshotShards({ ...source, papers: [...source.papers, ...added] });
  const previous = new Map(before.shards.map((shard, i) => [shard.bucket, { shard, text: before.texts[i] }]));
  const changed = after.shards.filter(
    (shard, i) => previous.get(shard.bucket)?.shard.sha256 !== shard.sha256,
  );
  assert.deepEqual(
    changed.map((shard) => shard.bucket),
    ["2026-10"],
  );
  for (const [i, shard] of after.shards.entries()) {
    if (shard.bucket !== "2026-10") assert.equal(after.texts[i], previous.get(shard.bucket)?.text);
  }
  assert.deepEqual(source, original);
  assert.deepEqual(createSnapshotShards({ ...source, papers: [...source.papers].reverse() }), before);
});

test("large months split by stable ID order with a byte cap independent of other months", () => {
  const source = {
    collectedAt: asOf,
    papers: Array.from({ length: 12 }, (_, i) => paper(`oct-${String(i).padStart(2, "0")}`, "2026-10-19")),
  };
  const before = createSnapshotShards(source, 250);
  assert.ok(before.shards.length > 1);
  assert.deepEqual(
    before.shards.map((shard) => shard.bucket),
    before.shards.map((_, i) => `2026-10.part-${i + 1}`),
  );
  assert.ok(before.shards.every((shard) => shard.bytes <= 250));
  const after = createSnapshotShards(
    { ...source, papers: [paper("older", "2026-09-01"), ...source.papers] },
    250,
  );
  assert.deepEqual(
    after.shards.filter((shard) => shard.bucket.startsWith("2026-10")),
    before.shards,
  );
  assert.deepEqual(
    before.texts.flatMap((text) => JSON.parse(text)).map((record) => record.id),
    source.papers.map((record) => record.id),
  );
});

function byBucket(manifest: SnapshotManifest) {
  return new Map(manifest.shards.map((shard) => [shard.bucket!, shard.sha256]));
}

test("archive writes restore the existing library order while only the current month's shard changes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-stable-archive-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json"),
    source = library();
  const first = await writeSnapshotFile(file, source);
  const papers = [
    ...source.papers,
    ...Array.from({ length: 5 }, (_, i) => paper(`oct-new-${i}`, "2026-10-20")),
  ];
  const second = await writeSnapshotFile(file, { ...source, collectedAt: "2026-10-20T13:00:00Z", papers });
  const before = byBucket(first),
    after = byBucket(second);
  assert.deepEqual(
    [...after].filter(([bucket, hash]) => before.get(bucket) !== hash).map(([bucket]) => bucket),
    ["2026-10"],
  );
  assert.deepEqual(await readSnapshotFile(file), {
    collectedAt: "2026-10-20T13:00:00Z",
    totalStored: papers.length,
    papers: [...papers].sort(compareSnapshotPapers),
  });
  assert.deepEqual(await resolveSnapshot(first, (path) => readFile(join(dir, path), "utf8")), {
    ...source,
    totalStored: source.papers.length,
    papers: [...source.papers].sort(compareSnapshotPapers),
  });
});

test("new public query URLs append without renumbering unchanged older-month shards across deployments", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-stable-public-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = {
    ...library(),
    papers: library().papers.map((record) => ({
      ...record,
      provenance: [{ queryUrl: "https://example.org/z-existing", collectedAt: asOf }],
    })),
  };
  const firstFile = join(dir, "first", "public-papers-v2.json");
  const first = await writePublicSnapshot(firstFile, source);
  const added = Array.from({ length: 5 }, (_, i) => ({
    ...paper(`oct-new-${i}`, "2026-10-20"),
    provenance: [{ queryUrl: "https://example.org/a-new", collectedAt: asOf }],
  }));
  const secondFile = join(dir, "second", "public-papers-v2.json"),
    papers = [...source.papers, ...added];
  const second = await writePublicSnapshot(secondFile, { ...source, papers }, firstFile);
  assert.deepEqual(second.queryUrls, ["https://example.org/z-existing", "https://example.org/a-new"]);
  const before = byBucket(first);
  assert.deepEqual(
    second.shards.filter((shard) => before.get(shard.bucket!) !== shard.sha256).map((shard) => shard.bucket),
    ["2026-10"],
  );
  assert.deepEqual(await readSnapshotFile(secondFile), {
    ...source,
    totalStored: papers.length,
    papers: [...papers].sort(compareSnapshotPapers),
  });
  assert.deepEqual(await resolveSnapshot(first, (path) => readFile(join(dir, "second", path), "utf8")), {
    ...source,
    totalStored: source.papers.length,
    papers: [...source.papers].sort(compareSnapshotPapers),
  });
  assert.deepEqual(await writePublicSnapshot(secondFile, { ...source, papers }), second);
});

test("a changed historical provenance entry changes its own month without hiding collected evidence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-stable-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json"),
    source = library();
  const first = await writeSnapshotFile(file, source);
  const papers = source.papers.map((record) =>
    record.id === "aug-a"
      ? { ...record, provenance: [{ queryUrl: "https://example.org/new-proof", collectedAt: asOf }] }
      : record,
  );
  const second = await writeSnapshotFile(file, { ...source, papers });
  const before = byBucket(first);
  assert.deepEqual(
    second.shards.filter((shard) => before.get(shard.bucket!) !== shard.sha256).map((shard) => shard.bucket),
    ["2026-08"],
  );
  assert.deepEqual(
    (await readSnapshotFile(file)).papers.find((record: { id: string }) => record.id === "aug-a"),
    papers.find((record) => record.id === "aug-a"),
  );
});

test("an archive write preserves a sibling public manifest and its encoded shards", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-stable-siblings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = library(),
    publicFile = join(dir, "public-papers-v2.json");
  const publicManifest = await writePublicSnapshot(publicFile, source);
  await writeSnapshotFile(join(dir, "papers.json"), {
    collectedAt: asOf,
    papers: [paper("different", "2026-07-01")],
  });
  assert.deepEqual(await resolveSnapshot(publicManifest, (path) => readFile(join(dir, path), "utf8")), {
    ...source,
    totalStored: source.papers.length,
    papers: [...source.papers].sort(compareSnapshotPapers),
  });
});

test("legacy manifests retain wire order and optional bucket fields validate independently of record integrity", async () => {
  const records = [paper("a-old", "2026-09-01"), paper("z-new", "2026-10-20")];
  const text = JSON.stringify(records),
    sha256 = createHash("sha256").update(text).digest("hex");
  const base: SnapshotManifest = {
    schema: "research-monitor-shards-v1",
    totalStored: 2,
    metadata: { totalStored: 2 },
    shards: [{ path: `papers/${sha256}.json`, sha256, count: 2, bytes: Buffer.byteLength(text) }],
  };
  assert.deepEqual((await resolveSnapshot(base, async () => text)).papers, records);
  for (const bucket of ["2026-10", "2026-10.part-1", "undated", "undated.part-2"]) {
    const manifest = { ...base, shards: base.shards.map((shard) => ({ ...shard, bucket })) };
    assert.doesNotThrow(() => parseSnapshotManifest(manifest));
    assert.deepEqual(
      (await resolveSnapshot(manifest, async () => text)).papers,
      [...records].sort(compareSnapshotPapers),
    );
  }
  for (const bucket of ["2026-13", "2026-10.part-0", "../unsafe", "", null, 10]) {
    assert.throws(() =>
      parseSnapshotManifest({ ...base, shards: base.shards.map((shard) => ({ ...shard, bucket })) }),
    );
  }
});

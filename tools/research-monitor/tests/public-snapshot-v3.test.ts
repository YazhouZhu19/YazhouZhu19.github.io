import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_SHARD_BYTES, PUBLIC_SNAPSHOT_V3_SCHEMA, compareSnapshotPapers, parseSnapshotManifest, resolveSnapshot } from "../lib/snapshot";
import { readSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot, writePublicSnapshotV3 } from "../scripts/public-snapshot";
import { copyPreviousSnapshotShards } from "../scripts/snapshot-install";

const asOf = "2026-10-20T12:00:00Z";
const institution = "Department of Medical Image Analysis, Example University, China";
function library() {
  return { totalStored: 3, collectedAt: asOf, custom: { preserved: [false, null] }, papers: [
    { id: "october", publishedAt: "2026-10-19", title: "October", abstract: "An equal original abstract.", originalAbstract: "An equal original abstract.",
      authors: [{ name: "A Person", displayName: "Person A", orcid: null, affiliations: [institution], extra: { retained: true } }],
      affiliations: [institution], provenance: [{ queryUrl: "https://example.org/z-existing", collectedAt: asOf }], unknownField: "never dropped" },
    { id: "september", publishedAt: "2026-09-01", title: "September", abstract: "A missing original abstract.",
      authors: [{ name: "B Person", affiliations: [institution] }], affiliations: [institution],
      provenance: [{ queryUrl: "https://example.org/z-existing", collectedAt: asOf }] },
    { id: "august", publishedAt: "2026-08-01", title: "August", abstract: "A null original abstract.", originalAbstract: null,
      authors: [], affiliations: [], provenance: [] },
  ] };
}

test("public v3, v2 and source records are fully equal, including unknown fields and original absence", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-v3-roundtrip-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = library(), original = structuredClone(source);
  const v2File = join(dir, "public-papers-v2.json"), v3File = join(dir, "public-papers-v3.json");
  const v2 = await writePublicSnapshot(v2File, source);
  const v3 = await writePublicSnapshotV3(v3File, source);
  assert.equal(v3.schema, PUBLIC_SNAPSHOT_V3_SCHEMA);
  assert.deepEqual(v3.affiliations, [institution]);
  assert.deepEqual(await readSnapshotFile(v2File), source);
  assert.deepEqual(await readSnapshotFile(v3File), source);
  assert.deepEqual(source, original);
  assert.equal("originalAbstract" in (await readSnapshotFile(v3File)).papers[1], false);
  for (const shard of v3.shards) assert.ok((await stat(join(dir, shard.path))).size <= MAX_SHARD_BYTES);
  assert.ok(v3.shards.reduce((sum, shard) => sum + shard.bytes, 0) < v2.shards.reduce((sum, shard) => sum + shard.bytes, 0));
});

test("v3 appends dictionaries and changes only the month containing new papers", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-v3-stable-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = library(), firstFile = join(dir, "first", "public-papers-v3.json");
  const first = await writePublicSnapshotV3(firstFile, source);
  const added = { ...source.papers[0], id: "october-new", publishedAt: "2026-10-20", authors: [
    { name: "C Person", orcid: "0000-0000-0000-0001", affiliations: ["AAA New Shared Medical Institution"] },
  ], affiliations: ["AAA New Shared Medical Institution"], provenance: [{ queryUrl: "https://example.org/a-new", collectedAt: asOf }] };
  const next = { ...source, totalStored: 4, papers: [added, ...source.papers] };
  const secondFile = join(dir, "second", "public-papers-v3.json");
  const second = await writePublicSnapshotV3(secondFile, next, firstFile);
  assert.deepEqual(second.affiliations?.slice(0, first.affiliations!.length), first.affiliations);
  assert.deepEqual(second.queryUrls?.slice(0, first.queryUrls!.length), first.queryUrls);
  const hashes = new Map(first.shards.map(shard => [shard.bucket, shard.sha256]));
  assert.deepEqual(second.shards.filter(shard => hashes.get(shard.bucket) !== shard.sha256).map(shard => shard.bucket), ["2026-10"]);
  assert.deepEqual(await readSnapshotFile(secondFile), { ...next, papers: [...next.papers].sort(compareSnapshotPapers) });
  assert.deepEqual(await resolveSnapshot(first, path => readFile(join(dir, "second", path), "utf8")), source);
});

test("v3 leaves affiliations literal when the shared manifest has no safe dictionary capacity", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-v3-cap-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = { ...library(), extraMetadata: "x".repeat(MAX_SHARD_BYTES - 2300) };
  const file = join(dir, "public-papers-v3.json");
  const manifest = await writePublicSnapshotV3(file, source);
  assert.equal(manifest.schema, PUBLIC_SNAPSHOT_V3_SCHEMA);
  assert.deepEqual(manifest.affiliations, []);
  assert.ok((await stat(file)).size <= MAX_SHARD_BYTES);
  assert.deepEqual(await readSnapshotFile(file), source);
});

test("publishing both formats retains each preceding public generation after sibling pruning", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-v3-generations-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = library();
  const previousV2 = join(dir, "previous", "public-papers-v2.json"), previousV3 = join(dir, "previous", "public-papers-v3.json");
  const firstV2 = await writePublicSnapshot(previousV2, source);
  const firstV3 = await writePublicSnapshotV3(previousV3, source);
  const next = { ...source, papers: source.papers.map(paper => ({ ...paper, abstract: `${paper.abstract} Updated.` })) };
  const nextDir = join(dir, "next");
  await writePublicSnapshot(join(nextDir, "public-papers-v2.json"), next, previousV2);
  await writePublicSnapshotV3(join(nextDir, "public-papers-v3.json"), next, previousV3);
  await copyPreviousSnapshotShards(previousV2, nextDir);
  await copyPreviousSnapshotShards(previousV3, nextDir);
  for (const manifest of [firstV2, firstV3]) {
    assert.deepEqual(await resolveSnapshot(manifest, path => readFile(join(nextDir, path), "utf8")), source);
  }
});

test("v3 manifests require a unique string affiliation dictionary before any shard is loaded", async () => {
  const empty = { schema: PUBLIC_SNAPSHOT_V3_SCHEMA, totalStored: 0, metadata: { totalStored: 0 }, shards: [], queryUrls: [], affiliations: [] };
  assert.doesNotThrow(() => parseSnapshotManifest(empty));
  for (const affiliations of [undefined, null, [1], ["same", "same"]]) {
    assert.throws(() => parseSnapshotManifest({ ...empty, affiliations }));
  }
  assert.deepEqual(await resolveSnapshot(empty, async () => { throw new Error("must not fetch"); }), { totalStored: 0, papers: [] });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PUBLIC_SNAPSHOT_SCHEMA, parseSnapshotManifest, resolveSnapshot } from "../lib/snapshot";
import { monitorDataSchema } from "../lib/local-api";
import { readSnapshotFile, writeSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot } from "../scripts/public-snapshot";

function library(prefix = "paper") {
  return { totalStored: 5, metadataNotInZod: { exact: "保留 ✓" }, papers: Array.from({ length: 5 }, (_, index) => ({
    id: `${prefix}:${index}`, abstract: "Plain abstract", originalAbstract: "<p>Original abstract</p>", custom: { data: [1, false, null] },
    provenance: [
      { queryUrl: `https://example.org/search?q=${"long-query".repeat(30)}`, collectedAt: "2026-10-04T00:00:00Z", extra: index },
      { queryUrl: "https://example.org/second?q=%E8%AE%B0%E5%BD%95", sourceRecordId: "原始标识" },
      { collectedAt: "2026-10-03T00:00:00Z" },
    ],
  })) };
}

test("public dictionary round-trips every original field and provenance entry without touching the archive", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-public-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = library();
  const original = structuredClone(source);
  const sourceFile = join(dir, "archive", "papers.json");
  await writeSnapshotFile(sourceFile, source, 1500);
  const sourceBytes = await readFile(sourceFile);
  const file = join(dir, "public", "papers.json");
  const manifest = await writePublicSnapshot(file, source, undefined, 1500);
  assert.equal(manifest.schema, PUBLIC_SNAPSHOT_SCHEMA);
  assert.equal(manifest.queryUrls!.length, 2);
  assert.deepEqual(source, original);
  assert.deepEqual(await readFile(sourceFile), sourceBytes);
  assert.deepEqual(await readSnapshotFile(file), source);
  for (const shard of manifest.shards) {
    const bytes = await readFile(join(dir, "public", shard.path));
    assert.ok(bytes.length <= 1500);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), shard.sha256);
    const encoded = JSON.parse(bytes.toString());
    assert.equal(typeof encoded[0].provenance[0].queryUrl, "number");
    assert.equal("queryUrl" in encoded[0].provenance[2], false);
  }
  const again = await writePublicSnapshot(file, source, undefined, 1500);
  assert.deepEqual(again, manifest);
});

test("the preceding public generation, including a v1 archive, remains readable after deployment", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-public-previous-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const firstFile = join(dir, "first", "papers.json");
  const first = await writeSnapshotFile(firstFile, library("first"), 1500);
  const secondFile = join(dir, "second", "papers.json");
  const second = await writePublicSnapshot(secondFile, library("second"), firstFile, 1500);
  assert.deepEqual(await resolveSnapshot(first, path => readFile(join(dir, "second", path), "utf8")), library("first"));
  const thirdFile = join(dir, "third", "papers.json");
  const third = await writePublicSnapshot(thirdFile, library("third"), secondFile, 1500);
  assert.deepEqual(await resolveSnapshot(second, path => readFile(join(dir, "third", path), "utf8")), library("second"));
  assert.deepEqual((await readdir(join(dir, "third", "papers"))).sort(), [...second.shards, ...third.shards].map(s => s.path.slice(7)).sort());
});

test("public dictionaries reject unsafe URLs and duplicate entries before fetching shards", () => {
  const empty = { schema: PUBLIC_SNAPSHOT_SCHEMA, totalStored: 0, metadata: { totalStored: 0 }, shards: [], queryUrls: [] };
  for (const queryUrls of [undefined, ["javascript:alert(1)"], ["https://"], [null], ["https://example.org", "https://example.org"]]) {
    assert.throws(() => parseSnapshotManifest({ ...empty, queryUrls }));
  }
});

test("valid hashes cannot disguise an invalid query URL dictionary reference", async () => {
  for (const queryUrl of [-1, 0.5, 1, true, "0", null, {}, "https://example.org"]) {
    const body = JSON.stringify([{ id: "p", provenance: [{ queryUrl }] }]);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const manifest = { schema: PUBLIC_SNAPSHOT_SCHEMA, totalStored: 1, metadata: { totalStored: 1 }, queryUrls: ["https://example.org"],
      shards: [{ path: `papers/${sha256}.json`, count: 1, bytes: Buffer.byteLength(body), sha256 }] };
    await assert.rejects(resolveSnapshot(manifest, async () => body), /reference/);
  }
});

test("corrupt encoded bytes are rejected before dictionary expansion", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-public-corrupt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "papers.json");
  const manifest = await writePublicSnapshot(file, library());
  const shardFile = join(dir, manifest.shards[0].path);
  const body = await readFile(shardFile, "utf8");
  await writeFile(shardFile, body.replace('"queryUrl":0', '"queryUrl":1'));
  await assert.rejects(readSnapshotFile(file), /checksum/);
});

test("empty public libraries and provenance without query URLs need no dictionary entries", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-public-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const empty = { totalStored: 0, papers: [], retained: true };
  const file = join(dir, "papers.json");
  const manifest = await writePublicSnapshot(file, empty);
  assert.deepEqual(manifest.queryUrls, []);
  assert.deepEqual(await readSnapshotFile(file), empty);
});

test("a dictionary exceeding the manifest budget falls back losslessly to bounded v1 shards", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-public-fallback-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const timestamp = "2026-10-04T00:00:00Z";
  const source = { totalStored: 650, runs: [], queryRuns: [], collectedAt: timestamp, lastSuccessfulSync: null, coverage: "All original records",
    papers: Array.from({ length: 650 }, (_, index) => ({
      id: `large:${index}`, title: "Paper", abstract: "Evidence", authors: [], affiliations: [], doi: null,
      source: "arXiv", sources: ["arXiv"], status: "preprint", publishedAt: "2026-10-04", updatedAt: null,
      firstSeenAt: timestamp, venue: null, url: "https://example.org/paper", tasks: [], modalities: [], organs: [],
      methods: [], humanSignals: [], evidence: [], tracks: [], reviewStatus: "candidate",
      provenance: [{ collectedAt: timestamp, queryUrl: `https://example.org/query/${index}?q=${"x".repeat(7000)}` }],
    })) };
  monitorDataSchema.parse(source);
  const file = join(dir, "public-papers-v2.json");
  const manifest = await writePublicSnapshot(file, source);
  assert.equal(manifest.schema, "research-monitor-shards-v1");
  assert.equal(manifest.queryUrls, undefined);
  assert.ok(manifest.shards.length > 1);
  assert.deepEqual(await readSnapshotFile(file), source);
});

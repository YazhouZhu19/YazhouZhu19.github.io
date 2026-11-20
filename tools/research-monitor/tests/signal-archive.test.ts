import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  emptyResearchSignalsData,
  SIGNALS_ARCHIVE_MAX_BYTES,
  SIGNALS_MAX_BYTES,
  type GitHubSignal,
  type NewsSignal,
  type ResearchSignalsData,
  type SignalSourceState,
} from "../lib/research-signals";
import { MAX_SHARD_BYTES } from "../lib/snapshot";
import {
  compactSignalArchive,
  readSignalArchive,
  readSignalArchiveFile,
  writeSignalArchiveFile,
} from "../scripts/signal-archive";

const now = "2026-11-18T00:00:00.000Z";
function repository(name: string): GitHubSignal {
  return {
    id: `github:lab/${name}`,
    kind: "github",
    title: `lab/${name}`,
    fullName: `lab/${name}`,
    url: `https://github.com/lab/${name}`,
    summary: "医学影像 — complete source evidence ✓",
    summaryKind: "repository-description",
    publisher: "lab",
    publishedAt: "2026-10-02T02:00:00Z",
    firstSeenAt: "2026-10-03T02:00:00Z",
    observedAt: now,
    updatedAt: null,
    topics: ["medical-imaging", "segmentation"],
    sourceId: "github-public",
    relatedUrls: ["https://example.org/dataset"],
    stars: 10,
    forks: 2,
    openIssues: 1,
    license: null,
    language: "Python",
    archived: false,
    pushedAt: "2026-10-21T02:00:00Z",
    releasedAt: null,
    releaseUrl: null,
    readmeExcerpt: "A retained dataset and code history.",
  };
}
function article(): NewsSignal {
  return {
    id: "news:z",
    kind: "news",
    title: "Medical imaging model",
    url: "https://example.org/news",
    summary: "Original publisher excerpt",
    summaryKind: "publisher-excerpt",
    publisher: "Example",
    publishedAt: "2026-10-20T02:00:00Z",
    firstSeenAt: "2026-10-20T03:00:00Z",
    observedAt: now,
    updatedAt: null,
    topics: [],
    sourceId: "news-example",
    relatedUrls: [],
    newsType: "research",
    discoveryUrl: null,
    originalUrl: "https://example.org/news",
    discoveryGroups: [],
    relevance: { level: "candidate", reasons: ["source-metadata"] },
  };
}
function source(kind: "github" | "news"): SignalSourceState {
  return {
    id: kind === "github" ? "github-public" : "news-example",
    kind,
    name: kind,
    url: "https://example.org/",
    status: "partial",
    checkedAt: now,
    lastSuccessAt: now,
    received: 1,
    retained: kind === "github" ? 2 : 1,
    error: "A source remained unavailable; saved evidence retained.",
    coverage: "Public records",
  };
}
function library(): ResearchSignalsData {
  return {
    ...emptyResearchSignalsData(now),
    records: [article(), repository("z"), repository("a")],
    sources: [source("news"), source("github")],
    discoveryState: {
      github: {
        catalogVersion: "test",
        cursor: 2,
        queue: [{ groupId: "segmentation", query: "medical imaging", sort: "updated", page: 1 }],
        completedQueries: 4,
        repositoryCursor: 1,
        cycles: 0,
      },
      news: {
        catalogVersion: "test",
        cursor: 1,
        queue: [{ queryId: "medical-imaging-en", from: "2026-01-01", to: "2026-02-01" }],
        completedWindows: 3,
        recentCheckedAt: { "medical-imaging-en": now },
      },
    },
  };
}
async function temporary(t: { after: (cleanup: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "monitor-signal-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const text = (value: unknown) => JSON.stringify(value) + "\n";
const smallLimit = (data: ResearchSignalsData) =>
  Math.max(...data.records.map((record) => Buffer.byteLength(JSON.stringify(record)))) + 4;

test("legacy source migration preserves record order, optional presence, metadata and counts exactly", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const original = library(),
    content = text(original);
  await writeFile(file, content);
  const legacy = await readSignalArchive(file);
  assert.equal(legacy.format, "legacy");
  assert.equal(legacy.bytes, Buffer.byteLength(content));
  assert.deepEqual(legacy.data, original);
  const manifest = await writeSignalArchiveFile(file, legacy.data, smallLimit(original));
  assert.equal(manifest.schema, "research-monitor-signals-source-v1");
  assert.equal(manifest.totalRecords, original.records.length);
  assert.ok(manifest.shards.length > 1);
  assert.deepEqual(manifest.metadata, (({ records: _records, ...metadata }) => metadata)(original));
  let bytes = (await stat(file)).size;
  for (const shard of manifest.shards) {
    const body = await readFile(join(directory, shard.path));
    assert.ok(body.length <= smallLimit(original));
    assert.equal(shard.bytes, body.length);
    assert.equal(shard.sha256, createHash("sha256").update(body).digest("hex"));
    bytes += body.length;
  }
  const restored = await readSignalArchive(file);
  assert.equal(restored.format, "sharded");
  assert.equal(restored.bytes, bytes);
  assert.deepEqual(restored.data, original);
  assert.equal("discoveryGroups" in restored.data.records[1], false);
  assert.deepEqual(restored.data.records[0].discoveryGroups, []);
  assert.deepEqual(await readSignalArchiveFile(file), original);
});

test("unchanged archives are deterministic and the preceding manifest remains readable after an update", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const original = library();
  await writeSignalArchiveFile(file, original, smallLimit(original));
  const first = await readFile(file);
  const previousFile = join(directory, "previous.json");
  await writeFile(previousFile, first);
  await writeSignalArchiveFile(file, original, smallLimit(original));
  assert.deepEqual(await readFile(file), first);
  const next = {
    ...original,
    generatedAt: "2026-11-18T01:00:00.000Z",
    records: [...original.records, repository("new")],
  };
  await writeSignalArchiveFile(file, next, smallLimit(next));
  assert.deepEqual(await readSignalArchiveFile(file), next);
  assert.deepEqual(await readSignalArchiveFile(previousFile), original);
});

test("missing, corrupt, miscounted or duplicate shards never return a partial source", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const manifest = await writeSignalArchiveFile(file, library(), smallLimit(library()));
  const originalManifest = text(manifest);
  const shard = manifest.shards[0],
    path = join(directory, shard.path),
    original = await readFile(path);
  await rm(path);
  await assert.rejects(readSignalArchiveFile(file));
  await writeFile(path, Buffer.from(original.toString().replace("Medical", "Changed")));
  await assert.rejects(readSignalArchiveFile(file));
  await writeFile(path, original);
  for (const changed of [
    { ...manifest, totalRecords: manifest.totalRecords + 1 },
    { ...manifest, shards: manifest.shards.map((s, i) => (i ? s : { ...s, count: s.count + 1 })) },
    {
      ...manifest,
      shards: [...manifest.shards, manifest.shards[0]],
      totalRecords: manifest.totalRecords + manifest.shards[0].count,
    },
  ]) {
    await writeFile(file, text(changed));
    await assert.rejects(readSignalArchiveFile(file));
  }
  await writeFile(file, originalManifest);
  assert.deepEqual(await readSignalArchiveFile(file), library());
});

test("cross-shard duplicate IDs and unknown sources fail even with valid byte hashes", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const manifest = await writeSignalArchiveFile(file, library(), smallLimit(library()));
  for (const duplicate of [true, false]) {
    const changed = structuredClone(manifest),
      descriptor = changed.shards.at(-1)!;
    const rows = JSON.parse(await readFile(join(directory, descriptor.path), "utf8"));
    if (duplicate) rows[0].id = library().records[0].id;
    else rows[0].sourceId = "missing-source";
    const body = text(rows),
      hash = createHash("sha256").update(body).digest("hex");
    Object.assign(descriptor, {
      sha256: hash,
      path: `research-signals/${hash}.json`,
      bytes: Buffer.byteLength(body),
    });
    await writeFile(join(directory, descriptor.path), body);
    await writeFile(file, text(changed));
    await assert.rejects(readSignalArchiveFile(file));
  }
});

test("source readers reject traversal, symlink manifests, shards and shard directories", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const manifest = await writeSignalArchiveFile(file, library(), smallLimit(library()));
  const alias = join(directory, "alias.json");
  await symlink(file, alias);
  await assert.rejects(readSignalArchiveFile(alias));
  for (const path of [
    "../outside.json",
    "/tmp/outside.json",
    `research-signals/../${manifest.shards[0].sha256}.json`,
  ]) {
    await writeFile(
      file,
      text({ ...manifest, shards: manifest.shards.map((s, i) => (i ? s : { ...s, path })) }),
    );
    await assert.rejects(readSignalArchiveFile(file));
  }
  await writeFile(file, text(manifest));
  const shard = manifest.shards[0],
    path = join(directory, shard.path),
    body = await readFile(path);
  const target = join(directory, "external-shard.json");
  await writeFile(target, body);
  await rm(path);
  await symlink(target, path);
  await assert.rejects(readSignalArchiveFile(file));
  await rm(path);
  await writeFile(path, body);
  const separate = join(directory, "linked");
  await mkdir(separate);
  await writeFile(join(separate, "research-signals.json"), text(manifest));
  await symlink(join(directory, "research-signals"), join(separate, "research-signals"));
  await assert.rejects(readSignalArchiveFile(join(separate, "research-signals.json")));
});

test("invalid input and an unwritable immutable shard target preserve the previous committed manifest", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const original = library();
  await writeSignalArchiveFile(file, original, smallLimit(original));
  const before = await readFile(file);
  await assert.rejects(
    writeSignalArchiveFile(file, { ...original, records: [...original.records, original.records[0]] }),
  );
  await assert.rejects(writeSignalArchiveFile(file, original, 3));
  assert.deepEqual(await readFile(file), before);
  const next = { ...original, records: [repository("new")] };
  const staging = join(directory, "stage");
  await mkdir(staging);
  const nextManifest = await writeSignalArchiveFile(join(staging, "research-signals.json"), next);
  const external = join(directory, "external.txt");
  await writeFile(external, "keep external file");
  await symlink(external, join(directory, nextManifest.shards[0].path));
  await assert.rejects(writeSignalArchiveFile(file, next));
  assert.deepEqual(await readFile(file), before);
  assert.equal(await readFile(external, "utf8"), "keep external file");
  assert.deepEqual(await readSignalArchiveFile(file), original);
});

test("flat input keeps its 96 MiB cap and oversized sharded totals are rejected before loading data", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  await writeFile(file, "{}");
  await truncate(file, SIGNALS_MAX_BYTES + 1);
  await assert.rejects(readSignalArchiveFile(file), /size|large|limit|bytes/i);
  const { records: _records, ...metadata } = library();
  const count = Math.floor(SIGNALS_ARCHIVE_MAX_BYTES / MAX_SHARD_BYTES) + 1;
  const shards = Array.from({ length: count }, (_, index) => {
    const sha256 = index.toString(16).padStart(64, "0");
    return { path: `research-signals/${sha256}.json`, sha256, bytes: MAX_SHARD_BYTES, count: 1 };
  });
  await writeFile(
    file,
    text({ schema: "research-monitor-signals-source-v1", metadata, totalRecords: count, shards }),
  );
  await assert.rejects(readSignalArchiveFile(file), /size|large|limit|bytes/i);
});

test("invalid shard limits cannot replace a valid archive", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  await writeSignalArchiveFile(file, library());
  const before = await readFile(file);
  for (const limit of [0, 2, 3.5, NaN, Infinity, MAX_SHARD_BYTES + 1]) {
    await assert.rejects(writeSignalArchiveFile(file, library(), limit));
    assert.deepEqual(await readFile(file), before);
  }
  assert.ok((await readdir(join(directory, "research-signals"))).every((name) => !name.endsWith(".tmp")));
});

test("source aggregate includes its manifest bytes before opening any declared shard", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const { records: _records, ...metadata } = library();
  const manifest = {
    schema: "research-monitor-signals-source-v1",
    metadata,
    totalRecords: 64,
    shards: Array.from({ length: 64 }, (_, index) => {
      const sha256 = index.toString(16).padStart(64, "0");
      return { path: `research-signals/${sha256}.json`, sha256, bytes: MAX_SHARD_BYTES, count: 1 };
    }),
  };
  for (let index = 0; index < 3; index++)
    manifest.shards.at(-1)!.bytes = MAX_SHARD_BYTES - Buffer.byteLength(text(manifest));
  assert.equal(
    manifest.shards.reduce((sum, shard) => sum + shard.bytes, Buffer.byteLength(text(manifest))),
    SIGNALS_ARCHIVE_MAX_BYTES,
  );
  await writeFile(file, text(manifest));
  await assert.rejects(readSignalArchiveFile(file), { code: "ENOENT" });
  manifest.shards.at(-1)!.bytes++;
  await writeFile(file, text(manifest));
  await assert.rejects(readSignalArchiveFile(file), /aggregate size/);
});

test("compaction retains both complete generations and validates them before deleting any shard", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const original = library();
  await writeSignalArchiveFile(file, original, smallLimit(original));
  const previousFile = join(directory, "previous.json");
  await writeFile(previousFile, await readFile(file));
  const next = { ...original, records: [repository("next")] };
  await writeSignalArchiveFile(file, next);
  const orphanName = `${"f".repeat(64)}.json`,
    orphan = join(directory, "research-signals", orphanName);
  await writeFile(orphan, "[]\n");
  const missingPrevious = join(directory, "missing.json");
  await assert.rejects(compactSignalArchive(file, missingPrevious));
  assert.equal(await readFile(orphan, "utf8"), "[]\n");
  await compactSignalArchive(file, previousFile);
  assert.deepEqual(await readSignalArchiveFile(previousFile), original);
  assert.deepEqual(await readSignalArchiveFile(file), next);
  assert.equal((await readdir(join(directory, "research-signals"))).includes(orphanName), false);
  const before = await readFile(file);
  await compactSignalArchive(file, previousFile);
  assert.deepEqual(await readFile(file), before);
});

test("empty sources roundtrip without inventing records or shards", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const data = emptyResearchSignalsData(now);
  const manifest = await writeSignalArchiveFile(file, data);
  assert.deepEqual(manifest.shards, []);
  assert.equal(manifest.totalRecords, 0);
  assert.deepEqual(await readSignalArchiveFile(file), data);
});

test("compaction copies a complete preceding generation from a separate archive before pruning", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const external = join(directory, "backup"),
    previousFile = join(external, "research-signals.json");
  const original = library();
  const previous = await writeSignalArchiveFile(previousFile, original, smallLimit(original));
  const next = { ...original, records: [...original.records, repository("new")] };
  await writeSignalArchiveFile(file, next);
  const before = await readFile(file);
  await compactSignalArchive(file, previousFile);
  await writeFile(join(directory, "previous.json"), text(previous));
  await rm(external, { recursive: true });
  assert.deepEqual(await readSignalArchiveFile(join(directory, "previous.json")), original);
  assert.deepEqual(await readSignalArchiveFile(file), next);
  assert.deepEqual(await readFile(file), before);
});

test("a corrupt external previous generation prevents compaction from deleting orphan files", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const previousFile = join(directory, "backup", "research-signals.json");
  const previous = await writeSignalArchiveFile(previousFile, library(), smallLimit(library()));
  await writeSignalArchiveFile(file, { ...library(), records: [repository("current")] });
  const before = await readFile(file);
  const orphan = join(directory, "research-signals", `${"e".repeat(64)}.json`);
  await writeFile(orphan, "[]\n");
  await rm(join(directory, "backup", previous.shards[0].path));
  await assert.rejects(compactSignalArchive(file, previousFile));
  assert.deepEqual(await readFile(file), before);
  assert.equal(await readFile(orphan, "utf8"), "[]\n");
});

test("collector --init never treats a missing declared shard as a new empty archive", async (t) => {
  const directory = await temporary(t),
    file = join(directory, "research-signals.json");
  const manifest = await writeSignalArchiveFile(file, library(), smallLimit(library()));
  const before = await readFile(file);
  await rm(join(directory, manifest.shards[0].path));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/collect-signals.ts", "--init", "--input", file, "--output", file],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined, "Collector must fail before it attempts network requests");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Signals input missing or invalid/);
  assert.deepEqual(await readFile(file), before);
});

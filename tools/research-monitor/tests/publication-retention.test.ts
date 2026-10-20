import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readSnapshotFile, writeSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot, writePublicSnapshotV3 } from "../scripts/public-snapshot";
import { readSignalsSnapshot, writeSignalsSnapshot } from "../scripts/signals-snapshot";
import { checkPublicationSize, publicationSize, prunePublishedShards } from "../scripts/publication-retention";
import { emptyResearchSignalsData, type GitHubSignal } from "../lib/research-signals";

const now = "2026-10-21T00:00:00Z";
function signal(id: string): GitHubSignal {
  return {
    id: `github:lab/${id}`, kind: "github", title: id, fullName: `lab/${id}`, url: `https://github.com/lab/${id}`,
    summary: "Medical image segmentation", summaryKind: "repository-description", publisher: "lab", publishedAt: now,
    firstSeenAt: now, observedAt: now, updatedAt: null, topics: [], sourceId: "github-public", relatedUrls: [],
    stars: 1, forks: 0, openIssues: 0, license: null, language: null, archived: false, pushedAt: now,
    releasedAt: null, releaseUrl: null, readmeExcerpt: "",
  };
}
async function generation(directory: string, id: string) {
  const data = { collectedAt: now, totalStored: 1, papers: [{
    id, publishedAt: "2026-10-20", abstract: "Original", originalAbstract: "Original", authors: [], affiliations: [],
    provenance: [{ queryUrl: "https://example.org/search", collectedAt: now }],
  }] };
  await writeSnapshotFile(join(directory, "papers.json"), data);
  await writePublicSnapshot(join(directory, "public-papers-v2.json"), data);
  await writePublicSnapshotV3(join(directory, "public-papers-v3.json"), data);
  const signals = { ...emptyResearchSignalsData(now), records: [signal(id)], sources: [{
    id: "github-public", kind: "github" as const, name: "GitHub", url: "https://github.com/",
    status: "ok" as const, checkedAt: now, lastSuccessAt: now, received: 1, retained: 1, error: null, coverage: "Public records",
  }] };
  await writeSignalsSnapshot(join(directory, "signals-v2", "manifest.json"), signals);
  return { data, signals };
}
async function orphan(directory: string) {
  const body = "unreferenced", hash = createHash("sha256").update(body).digest("hex");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${hash}.json`);
  await writeFile(file, body);
  return file;
}

test("publication keeps all current and preceding v1/v2/v3/signal references and removes only orphan hashes", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-retention-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = join(dir, "previous", "data"), current = join(dir, "current", "data");
  const before = await generation(previous, "previous"), latest = await generation(current, "current");
  const paperOrphan = await orphan(join(current, "papers")), signalOrphan = await orphan(join(current, "signals-v2", "shards"));
  const result = await prunePublishedShards(current, previous);
  assert.equal(result.removed.length, 2);
  assert.equal(result.removedBytes, 24);
  for (const file of [paperOrphan, signalOrphan]) await assert.rejects(readFile(file), { code: "ENOENT" });
  for (const name of ["papers.json", "public-papers-v2.json", "public-papers-v3.json"]) {
    assert.deepEqual(await readSnapshotFile(join(current, name)), latest.data);
    const manifest = JSON.parse(await readFile(join(previous, name), "utf8"));
    for (const shard of manifest.shards) assert.deepEqual(await readFile(join(current, shard.path)), await readFile(join(previous, shard.path)));
  }
  assert.deepEqual(await readSignalsSnapshot(join(current, "signals-v2", "manifest.json")), latest.signals);
  assert.equal(before.data.papers[0].id, "previous");
  assert.deepEqual((await prunePublishedShards(current, previous)).removed, []);
});

test("missing or corrupt retained references fail before deleting any orphan", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-retention-failure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await generation(dir, "one");
  const unreferenced = await orphan(join(dir, "papers"));
  const manifest = JSON.parse(await readFile(join(dir, "papers.json"), "utf8"));
  await writeFile(join(dir, manifest.shards[0].path), "corrupt");
  await assert.rejects(prunePublishedShards(dir), /integrity/);
  assert.equal(await readFile(unreferenced, "utf8"), "unreferenced");
});

test("publication size checks reject oversized output and symbolic-link traversal", async t => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-retention-size-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), "123456");
  assert.deepEqual(await publicationSize(dir), { bytes: 6, files: 1 });
  await assert.rejects(checkPublicationSize(dir, 5), /exceeding/);
  await mkdir(join(dir, "real"));
  await symlink(join(dir, "real"), join(dir, "papers"));
  await assert.rejects(prunePublishedShards(dir), /directory must be real/);
  await assert.rejects(publicationSize(dir), /symbolic link/);
  assert.deepEqual(await readdir(join(dir, "real")), []);
});

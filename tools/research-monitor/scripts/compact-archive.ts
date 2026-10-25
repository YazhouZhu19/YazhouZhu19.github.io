import assert from "node:assert/strict";
import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotFile } from "./snapshot-files";
import { readSnapshotManifest } from "./snapshot-install";
import { writePublicSnapshotV3 } from "./public-snapshot";

/** Internal archive only. Public compatibility generations are retained separately. */
export async function compactArchive(file: string) {
  const directory = dirname(file);
  const before = await readSnapshotFile(file);
  // Validate every sibling before changing the archive or removing any files.
  const siblings = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const candidate = join(directory, entry.name);
    if (resolve(candidate) === resolve(file)) continue;
    const manifest = await readSnapshotManifest(candidate);
    if (manifest) {
      await readSnapshotFile(candidate);
      siblings.push(manifest);
    }
  }
  const manifest = await writePublicSnapshotV3(file, before);
  assert.deepEqual(await readSnapshotFile(file), before, "Archive compaction changed records");
  const keep = new Set([manifest, ...siblings].flatMap((m) => m.shards.map((s) => s.path)));
  let removedBytes = 0;
  const removed: string[] = [];
  for (const name of await readdir(join(directory, "papers"))) {
    const path = `papers/${name}`;
    if (!/^[a-f0-9]{64}\.json$/.test(name) || keep.has(path)) continue;
    const info = await lstat(join(directory, path));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unexpected archive shard: ${path}`);
    await rm(join(directory, path));
    removedBytes += info.size;
    removed.push(path);
  }
  return { records: manifest.totalStored, removedBytes, removed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await compactArchive(resolve(process.argv[2] ?? "data/papers.json"))));
}

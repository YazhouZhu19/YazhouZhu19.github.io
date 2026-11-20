import assert from "node:assert/strict";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotFile } from "./snapshot-files";
import { parseSnapshotManifest } from "../lib/snapshot";
import { writePublicSnapshotV3 } from "./public-snapshot";

/** Internal archive only. Public compatibility generations are retained separately. */
export async function compactArchive(file: string, previousPublicFile?: string) {
  const directory = dirname(file);
  const before = await readSnapshotFile(file);
  // Other archive formats share this directory. Validate every paper sibling
  // before changing files, including paper-shaped documents with a broken schema.
  const siblings = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const candidate = join(directory, entry.name);
    if (resolve(candidate) === resolve(file)) continue;
    const value = JSON.parse(await readFile(candidate, "utf8"));
    const paperCandidate =
      /^(?:papers|public-papers-v\d+)\.json$/.test(entry.name) ||
      (typeof value?.schema === "string" && value.schema.startsWith("research-monitor-shards-")) ||
      value?.totalStored !== undefined ||
      (Array.isArray(value?.shards) &&
        value.shards.some(
          (shard: any) => typeof shard?.path === "string" && shard.path.startsWith("papers/"),
        ));
    if (!paperCandidate) continue;
    const manifest = parseSnapshotManifest(value);
    await readSnapshotFile(candidate);
    siblings.push(manifest);
  }
  // Collection writes v1, which has no dictionaries. Seed from the preceding
  // public v3 generation so newly discovered URLs do not renumber old shards.
  const manifest = await writePublicSnapshotV3(file, before, previousPublicFile);
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
  console.log(
    JSON.stringify(
      await compactArchive(
        resolve(process.argv[2] ?? "data/papers.json"),
        resolve(process.argv[3] ?? "../../research-monitor/data/public-papers-v3.json"),
      ),
    ),
  );
}

import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_SHARD_BYTES, parseSnapshotManifest } from "../lib/snapshot";
import { parseSignalsManifest } from "../lib/signals-snapshot";

export const PUBLICATION_MAX_BYTES = 800_000_000;
const paperManifests = ["papers.json", "public-papers-v2.json", "public-papers-v3.json"];
const signalManifest = "signals-v2/manifest.json";
type Reference = { path: string; bytes: number; sha256: string; source: string };

async function checkedFile(file: string, optional = false): Promise<Buffer | undefined> {
  let info;
  try {
    info = await lstat(file);
  } catch (error: any) {
    if (optional && error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Publication input must be a regular file: ${file}`);
  if (info.size > MAX_SHARD_BYTES) throw new Error(`Publication manifest/shard exceeds 4 MiB: ${file}`);
  return readFile(file);
}

async function collectReferences(dataDirectory: string, optional: boolean) {
  for (const directory of ["", "papers", "signals-v2", "signals-v2/shards"]) {
    let info;
    try {
      info = await lstat(join(dataDirectory, directory));
    } catch (error: any) {
      if (error.code === "ENOENT" && (optional || directory)) continue;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Publication shard directory must be real: ${join(dataDirectory, directory)}`);
  }
  const references: Reference[] = [];
  for (const name of paperManifests) {
    const body = await checkedFile(join(dataDirectory, name), optional);
    if (!body) continue;
    const manifest = parseSnapshotManifest(JSON.parse(body.toString("utf8")));
    for (const shard of manifest.shards)
      references.push({ ...shard, source: join(dataDirectory, shard.path) });
  }
  const body = await checkedFile(join(dataDirectory, signalManifest), optional);
  if (body) {
    const manifest = parseSignalsManifest(JSON.parse(body.toString("utf8")));
    for (const shard of manifest.shards)
      references.push({
        ...shard,
        path: `signals-v2/${shard.path}`,
        source: join(dataDirectory, "signals-v2", shard.path),
      });
  }
  return references;
}

/** Keep exactly the current and preceding references of every public format. */
export async function prunePublishedShards(dataDirectory: string, previousDataDirectory?: string) {
  const current = await collectReferences(dataDirectory, false);
  const previous = previousDataDirectory ? await collectReferences(previousDataDirectory, true) : [];
  const keep = new Map<string, Reference>();
  for (const reference of [...current, ...previous]) {
    const existing = keep.get(reference.path);
    if (existing && (existing.bytes !== reference.bytes || existing.sha256 !== reference.sha256)) {
      throw new Error(`Conflicting publication shard descriptor: ${reference.path}`);
    }
    if (!existing) keep.set(reference.path, reference);
  }
  // Validate every retained reference before deleting any orphan. Previous
  // manifests may reference shards absent from the collector's two generations.
  for (const reference of keep.values()) {
    const target = join(dataDirectory, reference.path);
    const existing = await checkedFile(target, true);
    const body = existing ?? (await checkedFile(reference.source));
    if (
      !body ||
      body.length !== reference.bytes ||
      createHash("sha256").update(body).digest("hex") !== reference.sha256
    ) {
      throw new Error(`Retained publication shard failed integrity: ${reference.path}`);
    }
    if (!existing) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(reference.source, target);
    }
  }
  let removedBytes = 0;
  const removed: string[] = [];
  for (const directory of ["papers", "signals-v2/shards"]) {
    const root = join(dataDirectory, directory);
    const entries = await readdir(root, { withFileTypes: true }).catch((error: any) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      if (keep.has(path)) continue;
      const info = await lstat(join(dataDirectory, path));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unexpected publication shard: ${path}`);
      removedBytes += info.size;
      await rm(join(dataDirectory, path));
      removed.push(path);
    }
  }
  return { retained: keep.size, removed, removedBytes };
}

/** Portable logical-file bytes; CI additionally checks GNU du's apparent size. */
export async function publicationSize(directory: string) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Publication directory must not be a symbolic link");
  let bytes = 0,
    files = 0;
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Publication contains a symbolic link: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        bytes += (await lstat(file)).size;
        files++;
      } else throw new Error(`Publication contains a special file: ${file}`);
    }
  }
  await walk(directory);
  return { bytes, files };
}

export async function checkPublicationSize(directory: string, limit = PUBLICATION_MAX_BYTES) {
  const size = await publicationSize(directory);
  if (size.bytes > limit)
    throw new Error(
      `Publication is ${size.bytes} bytes, exceeding the ${limit}-byte budget. Remove unreferenced generated shards before publishing.`,
    );
  return size;
}

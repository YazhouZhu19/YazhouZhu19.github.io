import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_SHARD_BYTES, PUBLIC_SNAPSHOT_SCHEMA, SNAPSHOT_SCHEMA, parseSnapshotManifest, type SnapshotManifest } from "../lib/snapshot";

export async function readSnapshotManifest(file: string): Promise<SnapshotManifest | undefined> {
  let value: unknown;
  try { value = JSON.parse(await readFile(file, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return; throw error; }
  if (value && typeof value === "object" && "schema" in value) return parseSnapshotManifest(value);
}

async function atomicWrite(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, "utf8"); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

/** Install verified immutable shards before replacing the final manifest once. */
export async function installSnapshot(
  file: string, manifest: SnapshotManifest, texts: string[],
  previous?: { file: string; manifest: SnapshotManifest },
) {
  parseSnapshotManifest(manifest);
  const manifestText = JSON.stringify(manifest) + "\n";
  if (Buffer.byteLength(manifestText) > MAX_SHARD_BYTES) throw new Error("Snapshot metadata exceeds size limit; snapshot unchanged");
  if (texts.length !== manifest.shards.length) throw new Error("Snapshot shard payload mismatch; snapshot unchanged");
  const keep = new Set(manifest.shards.map(shard => shard.path));
  // Retain the preceding generation and all explicitly named sibling snapshots.
  const current = await readSnapshotManifest(file);
  for (const shard of current?.shards ?? []) keep.add(shard.path);
  for (const shard of previous?.manifest.shards ?? []) keep.add(shard.path);
  const siblings = await readdir(dirname(file), { withFileTypes: true }).catch((error: any) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const sibling of siblings) {
    if (!sibling.isFile() || sibling.name === basename(file)) continue;
    let value: any;
    try { value = JSON.parse(await readFile(join(dirname(file), sibling.name), "utf8")); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if ([SNAPSHOT_SCHEMA, PUBLIC_SNAPSHOT_SCHEMA].includes(value?.schema)) {
      for (const shard of parseSnapshotManifest(value).shards) keep.add(shard.path);
    }
  }
  await mkdir(join(dirname(file), "papers"), { recursive: true });
  for (let index = 0; index < texts.length; index++) await atomicWrite(join(dirname(file), manifest.shards[index].path), texts[index]);
  if (previous && resolve(dirname(previous.file)) !== resolve(dirname(file))) {
    for (const shard of previous.manifest.shards) await copyFile(join(dirname(previous.file), shard.path), join(dirname(file), shard.path));
  }
  await atomicWrite(file, manifestText);
  for (const name of await readdir(join(dirname(file), "papers"))) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(`papers/${name}`)) await rm(join(dirname(file), "papers", name));
  }
}

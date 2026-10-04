import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { MAX_SHARD_BYTES, SNAPSHOT_SCHEMA, parseSnapshotManifest, resolveSnapshot, type SnapshotManifest } from "../lib/snapshot";

export async function readSnapshotFile(file: string) {
  return resolveSnapshot(JSON.parse(await readFile(file, "utf8")), path => readFile(join(dirname(file), path), "utf8"));
}

async function atomicWrite(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, "utf8"); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

/** Keep every field and paper. Install immutable shards before replacing the manifest. */
export async function writeSnapshotFile(file: string, data: { papers: { id: string }[] }, maxBytes = MAX_SHARD_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 3 || maxBytes > MAX_SHARD_BYTES) throw new Error("Invalid paper shard size limit");
  const ids = new Set<string>();
  const texts: string[] = [];
  let records: string[] = [], bytes = 3; // brackets and final newline
  for (const paper of data.papers) {
    if (!paper || typeof paper.id !== "string" || !paper.id || ids.has(paper.id)) throw new Error("Missing or duplicate paper ID; snapshot unchanged");
    ids.add(paper.id);
    const text = JSON.stringify(paper), size = Buffer.byteLength(text);
    if (size + 3 > maxBytes) throw new Error(`Paper ${paper.id} exceeds the shard size limit; snapshot unchanged`);
    if (records.length && bytes + size + 1 > maxBytes) { texts.push(`[${records.join(",")}]\n`); records = []; bytes = 3; }
    bytes += size + (records.length ? 1 : 0); records.push(text);
  }
  if (records.length) texts.push(`[${records.join(",")}]\n`);
  const { papers, ...rest } = data;
  const metadata: Record<string, unknown> = { ...rest, totalStored: papers.length };
  const manifest: SnapshotManifest = {
    schema: SNAPSHOT_SCHEMA, metadata, totalStored: papers.length,
    shards: texts.map(text => {
      const sha256 = createHash("sha256").update(text).digest("hex");
      return { path: `papers/${sha256}.json`, count: JSON.parse(text).length, bytes: Buffer.byteLength(text), sha256 };
    }),
  };
  parseSnapshotManifest(manifest);
  const manifestText = JSON.stringify(manifest) + "\n";
  if (Buffer.byteLength(manifestText) > MAX_SHARD_BYTES) throw new Error("Snapshot metadata exceeds size limit; snapshot unchanged");
  // One previous generation lets clients finish requests across a Pages deployment.
  const keep = new Set(manifest.shards.map(shard => shard.path));
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    if (previous.schema === SNAPSHOT_SCHEMA) for (const shard of parseSnapshotManifest(previous).shards) keep.add(shard.path);
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  // --output can name another manifest beside --input. Those snapshots share
  // the shard directory, so never prune records still referenced by a sibling.
  const siblings = await readdir(dirname(file), { withFileTypes: true }).catch((error: any) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const sibling of siblings) {
    if (!sibling.isFile() || sibling.name === basename(file)) continue;
    let value: any;
    try { value = JSON.parse(await readFile(join(dirname(file), sibling.name), "utf8")); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (value?.schema === SNAPSHOT_SCHEMA) for (const shard of parseSnapshotManifest(value).shards) keep.add(shard.path);
  }
  await mkdir(join(dirname(file), "papers"), { recursive: true });
  for (let index = 0; index < texts.length; index++) await atomicWrite(join(dirname(file), manifest.shards[index].path), texts[index]);
  await atomicWrite(file, manifestText);
  for (const name of await readdir(join(dirname(file), "papers"))) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(`papers/${name}`)) await rm(join(dirname(file), "papers", name));
  }
  return manifest;
}

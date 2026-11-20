import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseResearchSignalsData,
  SIGNALS_ARCHIVE_MAX_BYTES,
  SIGNALS_MAX_BYTES,
  SIGNALS_MAX_RECORDS,
  type ResearchSignal,
  type ResearchSignalsData,
} from "../lib/research-signals";
import { MAX_SHARD_BYTES } from "../lib/snapshot";

export const SIGNAL_ARCHIVE_SCHEMA = "research-monitor-signals-source-v1";
export type SignalArchiveManifest = {
  schema: typeof SIGNAL_ARCHIVE_SCHEMA;
  metadata: Omit<ResearchSignalsData, "records">;
  totalRecords: number;
  shards: { path: string; sha256: string; bytes: number; count: number }[];
};
const digest = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const keys = (value: object) => Object.keys(value).sort().join(",");

export function parseSignalArchiveManifest(raw: unknown): SignalArchiveManifest {
  const value = raw as SignalArchiveManifest;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    keys(value) !== "metadata,schema,shards,totalRecords" ||
    value.schema !== SIGNAL_ARCHIVE_SCHEMA ||
    !Number.isSafeInteger(value.totalRecords) ||
    value.totalRecords < 0 ||
    value.totalRecords > SIGNALS_MAX_RECORDS ||
    !Array.isArray(value.shards) ||
    value.shards.length > SIGNALS_MAX_RECORDS ||
    !value.metadata ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata) ||
    "records" in value.metadata
  )
    throw new Error("Invalid signal archive manifest");
  parseResearchSignalsData({ ...value.metadata, records: [] });
  let count = 0,
    bytes = 0;
  const paths = new Set<string>();
  for (const shard of value.shards) {
    if (
      !shard ||
      typeof shard !== "object" ||
      Array.isArray(shard) ||
      keys(shard) !== "bytes,count,path,sha256" ||
      !/^[a-f0-9]{64}$/.test(shard.sha256) ||
      shard.path !== `research-signals/${shard.sha256}.json` ||
      paths.has(shard.path) ||
      !Number.isSafeInteger(shard.bytes) ||
      shard.bytes < 1 ||
      shard.bytes > MAX_SHARD_BYTES ||
      !Number.isSafeInteger(shard.count) ||
      shard.count < 1
    )
      throw new Error("Invalid signal archive shard descriptor");
    paths.add(shard.path);
    count += shard.count;
    bytes += shard.bytes;
  }
  if (count !== value.totalRecords || bytes > SIGNALS_ARCHIVE_MAX_BYTES)
    throw new Error("Signal archive count or aggregate size exceeds limits");
  return value;
}

async function regularFile(file: string, maxBytes: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw new Error("Signal archive requires a regular file within the size limit");
  const body = await readFile(file);
  if (body.length !== info.size || body.length > maxBytes)
    throw new Error("Signal archive changed while reading or exceeds the size limit");
  return body;
}

async function regularDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Signal archive directory must not be a symlink");
}

/** Legacy imports stay supported; no consumer needs to know the storage format. */
export async function readSignalArchive(file: string): Promise<{
  data: ResearchSignalsData;
  bytes: number;
  format: "legacy" | "sharded";
}> {
  const body = await regularFile(file, SIGNALS_MAX_BYTES);
  const value = JSON.parse(body.toString("utf8"));
  if (value?.schema !== SIGNAL_ARCHIVE_SCHEMA) {
    return { data: parseResearchSignalsData(value), bytes: body.length, format: "legacy" };
  }
  if (body.length > MAX_SHARD_BYTES) throw new Error("Signal archive manifest exceeds 4 MiB");
  const manifest = parseSignalArchiveManifest(value);
  const bytes = body.length + manifest.shards.reduce((total, shard) => total + shard.bytes, 0);
  if (bytes > SIGNALS_ARCHIVE_MAX_BYTES) throw new Error("Signal archive exceeds aggregate size limit");
  const records: ResearchSignal[] = [];
  if (manifest.shards.length) await regularDirectory(join(dirname(file), "research-signals"));
  // Read one bounded shard at a time, keeping collector order and every field.
  for (const shard of manifest.shards) {
    const content = await regularFile(join(dirname(file), shard.path), shard.bytes);
    if (content.length !== shard.bytes || digest(content) !== shard.sha256)
      throw new Error("Signal archive shard size/checksum mismatch");
    const rows = JSON.parse(content.toString("utf8"));
    if (!Array.isArray(rows) || rows.length !== shard.count)
      throw new Error("Signal archive shard record count mismatch");
    for (const record of rows) records.push(record);
  }
  return { data: parseResearchSignalsData({ ...manifest.metadata, records }), bytes, format: "sharded" };
}

export async function readSignalArchiveFile(file: string): Promise<ResearchSignalsData> {
  return (await readSignalArchive(file)).data;
}

async function immutableShard(file: string, text: string | Buffer) {
  try {
    const existing = await regularFile(file, MAX_SHARD_BYTES);
    if (!existing.equals(typeof text === "string" ? Buffer.from(text) : text))
      throw new Error("Existing immutable signal shard is corrupt");
    return;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Verify the complete on-disk candidate before the sole manifest replacement. */
export async function writeSignalArchiveFile(
  file: string,
  input: ResearchSignalsData,
  maxShardBytes = MAX_SHARD_BYTES,
): Promise<SignalArchiveManifest> {
  if (!Number.isSafeInteger(maxShardBytes) || maxShardBytes < 3 || maxShardBytes > MAX_SHARD_BYTES)
    throw new Error("Invalid signal shard size limit");
  const data = parseResearchSignalsData(input);
  assert.deepEqual(data, input, "Signal validation changed collected fields");
  const { records, ...metadata } = data;
  const manifest: SignalArchiveManifest = {
    schema: SIGNAL_ARCHIVE_SCHEMA,
    metadata,
    totalRecords: records.length,
    shards: [],
  };
  const texts = new Map<string, string>();
  let rows: string[] = [],
    size = 3,
    totalBytes = 0;
  const flush = () => {
    if (!rows.length) return;
    const text = `[${rows.join(",")}]\n`,
      sha256 = digest(text);
    const path = `research-signals/${sha256}.json`,
      bytes = Buffer.byteLength(text);
    manifest.shards.push({ path, sha256, bytes, count: rows.length });
    texts.set(path, text);
    totalBytes += bytes;
    if (totalBytes > SIGNALS_ARCHIVE_MAX_BYTES)
      throw new Error("Signal archive exceeds aggregate size limit");
    rows = [];
    size = 3;
  };
  for (const record of records) {
    const text = JSON.stringify(record),
      bytes = Buffer.byteLength(text);
    if (bytes + 3 > maxShardBytes) throw new Error("Single signal record exceeds shard size limit");
    if (size + bytes + (rows.length ? 1 : 0) > maxShardBytes) flush();
    size += bytes + (rows.length ? 1 : 0);
    rows.push(text);
  }
  flush();
  parseSignalArchiveManifest(manifest);
  const manifestText = JSON.stringify(manifest) + "\n";
  if (
    Buffer.byteLength(manifestText) > MAX_SHARD_BYTES ||
    totalBytes + Buffer.byteLength(manifestText) > SIGNALS_ARCHIVE_MAX_BYTES
  )
    throw new Error("Signal archive manifest or aggregate size exceeds limits");
  await mkdir(dirname(file), { recursive: true });
  await regularDirectory(dirname(file));
  // A missing destination is valid for --init/copies, but never follow symlinks.
  try {
    await regularFile(file, SIGNALS_MAX_BYTES);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(join(dirname(file), "research-signals"), { recursive: true });
  await regularDirectory(join(dirname(file), "research-signals"));
  for (const [path, text] of texts) await immutableShard(join(dirname(file), path), text);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, manifestText, { flag: "wx" });
    assert.deepEqual(await readSignalArchiveFile(temporary), input, "Signal archive roundtrip changed data");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return manifest;
}

/** Only remove unreferenced generated files after validating both generations. */
export async function compactSignalArchive(file: string, previousFile?: string) {
  const keep = new Map<string, { shard: SignalArchiveManifest["shards"][number]; source: string }>();
  for (const candidate of [file, ...(previousFile ? [previousFile] : [])]) {
    const archive = await readSignalArchive(candidate);
    if (archive.format === "sharded") {
      const manifest = parseSignalArchiveManifest(JSON.parse(await readFile(candidate, "utf8")));
      for (const shard of manifest.shards)
        if (!keep.has(shard.path))
          keep.set(shard.path, { shard, source: join(dirname(candidate), shard.path) });
    }
  }
  const directory = join(dirname(file), "research-signals");
  await mkdir(directory, { recursive: true });
  await regularDirectory(directory);
  // A preceding archive may live in a separate backup directory or use different
  // shard boundaries. Bring its verified files into this archive before pruning.
  for (const { shard, source } of keep.values()) {
    const body = await regularFile(source, shard.bytes);
    if (body.length !== shard.bytes || digest(body) !== shard.sha256)
      throw new Error("Retained signal shard size/checksum mismatch");
    await immutableShard(join(dirname(file), shard.path), body);
  }
  for (const name of await readdir(directory)) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(`research-signals/${name}`)) {
      await regularFile(join(directory, name), MAX_SHARD_BYTES);
      await rm(join(directory, name));
    }
  }
}

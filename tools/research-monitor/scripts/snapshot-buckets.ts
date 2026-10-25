import { createHash } from "node:crypto";
import { MAX_SHARD_BYTES, type SnapshotShard } from "../lib/snapshot";

type SnapshotRecord = { id: string; publishedAt?: unknown };
type SnapshotInput = { papers: SnapshotRecord[]; collectedAt?: unknown };
export type BucketedSnapshotShard = SnapshotShard & { bucket: string };

function validDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return;
  const date = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  const timestamp = Date.parse(value);
  // Date.parse normalizes values such as February 30; those are undated too.
  if (
    !Number.isFinite(date) ||
    !Number.isFinite(timestamp) ||
    new Date(date).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return;
  return timestamp;
}

/** The snapshot time, rather than the build clock, determines future dates. */
export function snapshotBucket(publishedAt: unknown, asOf?: unknown): string {
  const timestamp = validDate(publishedAt),
    cutoff = validDate(asOf);
  return timestamp !== undefined && cutoff !== undefined && timestamp <= cutoff
    ? (publishedAt as string).slice(0, 7)
    : "undated";
}

/** Serialize independent month buckets without changing any record fields. */
export function createSnapshotShards(
  data: SnapshotInput,
  maxBytes = MAX_SHARD_BYTES,
  asOf = data.collectedAt,
  encode: (record: SnapshotRecord) => unknown = (record) => record,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 3 || maxBytes > MAX_SHARD_BYTES)
    throw new Error("Invalid paper shard size limit");
  const ids = new Set<string>(),
    buckets = new Map<string, SnapshotRecord[]>();
  for (const paper of data.papers) {
    if (!paper || typeof paper.id !== "string" || !paper.id || ids.has(paper.id))
      throw new Error("Missing or duplicate paper ID; snapshot unchanged");
    ids.add(paper.id);
    const bucket = snapshotBucket(paper.publishedAt, asOf),
      group = buckets.get(bucket) ?? [];
    group.push(paper);
    buckets.set(bucket, group);
  }
  const texts: string[] = [],
    shards: BucketedSnapshotShard[] = [];
  const keys = [...buckets.keys()].sort((a, b) =>
    a === "undated" ? 1 : b === "undated" ? -1 : b.localeCompare(a),
  );
  for (const bucket of keys) {
    const papers = [...buckets.get(bucket)!].sort((a, b) => a.id.localeCompare(b.id));
    const parts: { text: string; count: number }[] = [];
    let records: string[] = [],
      bytes = 3; // brackets and final newline
    const flush = () => {
      if (records.length) parts.push({ text: `[${records.join(",")}]\n`, count: records.length });
      records = [];
      bytes = 3;
    };
    for (const paper of papers) {
      const text = JSON.stringify(encode(paper)),
        size = Buffer.byteLength(text);
      if (size + 3 > maxBytes)
        throw new Error(`Paper ${paper.id} exceeds the shard size limit; snapshot unchanged`);
      if (records.length && bytes + size + 1 > maxBytes) flush();
      bytes += size + (records.length ? 1 : 0);
      records.push(text);
    }
    flush();
    for (const [index, { text, count }] of parts.entries()) {
      const sha256 = createHash("sha256").update(text).digest("hex");
      texts.push(text);
      shards.push({
        path: `papers/${sha256}.json`,
        count,
        bytes: Buffer.byteLength(text),
        sha256,
        bucket: parts.length === 1 ? bucket : `${bucket}.part-${index + 1}`,
      });
    }
  }
  return { texts, shards };
}

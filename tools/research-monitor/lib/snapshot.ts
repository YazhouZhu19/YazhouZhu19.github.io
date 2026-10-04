/** Shared by the browser and collector; no Node-only imports. */
export const SNAPSHOT_SCHEMA = "research-monitor-shards-v1";
export const MAX_SHARD_BYTES = 4 * 1024 * 1024;
export type SnapshotShard = { path: string; count: number; bytes: number; sha256: string };
export type SnapshotManifest = {
  schema: typeof SNAPSHOT_SCHEMA;
  metadata: Record<string, unknown>;
  totalStored: number;
  shards: SnapshotShard[];
};

export class SnapshotFormatError extends Error {
  constructor(message: string) { super(message); this.name = "SnapshotFormatError"; }
}

export function parseSnapshotManifest(raw: unknown): SnapshotManifest {
  const value = raw as SnapshotManifest;
  const fail = () => { throw new SnapshotFormatError("Invalid paper snapshot manifest"); };
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== SNAPSHOT_SCHEMA || !value.metadata || typeof value.metadata !== "object"
    || Array.isArray(value.metadata) || "papers" in value.metadata || !Number.isSafeInteger(value.totalStored)
    || value.totalStored < 0 || value.metadata.totalStored !== value.totalStored || !Array.isArray(value.shards)) fail();
  let count = 0;
  const paths = new Set<string>();
  for (const shard of value.shards) {
    if (!shard || typeof shard !== "object" || Array.isArray(shard) || typeof shard.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(shard.sha256) || shard.path !== `papers/${shard.sha256}.json`
      || !Number.isSafeInteger(shard.count) || shard.count <= 0 || !Number.isSafeInteger(shard.bytes)
      || shard.bytes <= 0 || shard.bytes > MAX_SHARD_BYTES || paths.has(shard.path)) fail();
    paths.add(shard.path); count += shard.count;
  }
  if (count !== value.totalStored) fail();
  return value;
}

/** Load a complete, verified snapshot. Never return a partially loaded library. */
export async function resolveSnapshot(raw: unknown, readShard: (path: string) => Promise<string>): Promise<any> {
  if (raw && typeof raw === "object" && !("schema" in raw)) return raw; // Legacy single-file snapshot.
  const manifest = parseSnapshotManifest(raw);
  const parts: any[][] = new Array(manifest.shards.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed) {
      const index = next++;
      if (index >= manifest.shards.length) return;
      try {
        const shard = manifest.shards[index];
        const text = await readShard(shard.path);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength !== shard.bytes) throw new SnapshotFormatError(`Paper shard size mismatch: ${shard.path}`);
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (hash !== shard.sha256) throw new SnapshotFormatError(`Paper shard checksum mismatch: ${shard.path}`);
        let records: unknown;
        try { records = JSON.parse(text); } catch { throw new SnapshotFormatError(`Invalid paper shard: ${shard.path}`); }
        if (!Array.isArray(records) || records.length !== shard.count) throw new SnapshotFormatError(`Paper shard count mismatch: ${shard.path}`);
        parts[index] = records;
      } catch (error) { failed = true; throw error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, manifest.shards.length) }, worker));
  const papers = parts.flat();
  const ids = new Set<string>();
  for (const paper of papers) {
    if (!paper || typeof paper.id !== "string" || !paper.id || ids.has(paper.id)) throw new SnapshotFormatError("Missing or duplicate paper ID in snapshot");
    ids.add(paper.id);
  }
  return { ...manifest.metadata, papers };
}

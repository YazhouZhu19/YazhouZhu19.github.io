import { MAX_SHARD_BYTES, SnapshotFormatError } from "./snapshot";

export type CachedShard = { sha256: string; bytes: number; path: string };
type CacheBackend = Pick<Cache, "match" | "put" | "delete" | "keys">;
type StorageBackend = { open(name: string): Promise<CacheBackend> };
type Generation = { current: string[]; previous: string[] };

const CACHE_NAME = "rm-shards-v1";
const HASH = /^[a-f0-9]{64}$/;
const KEY_ORIGIN = "https://rm-shards.invalid";

function aborted(signal?: AbortSignal) { signal?.throwIfAborted(); }

/** Cache keys never go on the network. Cached public data is always reverified. */
export async function verifyShardText(text: string, shard: CachedShard, signal?: AbortSignal) {
  aborted(signal);
  if (!HASH.test(shard.sha256) || !Number.isSafeInteger(shard.bytes) || shard.bytes < 1 || shard.bytes > MAX_SHARD_BYTES) {
    throw new SnapshotFormatError("Invalid cached shard descriptor");
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength !== shard.bytes) throw new SnapshotFormatError(`Shard size mismatch: ${shard.path}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  aborted(signal);
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== shard.sha256) throw new SnapshotFormatError(`Shard checksum mismatch: ${shard.path}`);
}

function browserStorage(): StorageBackend | undefined {
  try { return globalThis.caches; } catch { return undefined; }
}

function parseGeneration(value: unknown): Generation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Generation;
  if (![row.current, row.previous].every(values =>
    Array.isArray(values) && values.length <= 10000 && values.every(value => typeof value === "string" && HASH.test(value)))) return null;
  return { current: row.current, previous: row.previous };
}

/** Optional public-data cache. Storage denial never prevents a network load. */
export function createShardCache(namespace = "papers", options: { storage?: StorageBackend | null } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(namespace)) throw new Error("Invalid shard cache namespace");
  const prefix = `${KEY_ORIGIN}/${namespace}/`;
  const metadataKey = `${prefix}generations.json`;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  let cachePromise: Promise<CacheBackend | null> | undefined;
  let commits: Promise<void> = Promise.resolve();
  const open = () => cachePromise ??= storage
    ? Promise.resolve().then(() => storage.open(CACHE_NAME)).catch(() => null)
    : Promise.resolve(null);

  return {
    async read(shard: CachedShard, readNetwork: () => Promise<string>, signal?: AbortSignal): Promise<string> {
      aborted(signal);
      const cache = await open();
      aborted(signal);
      const key = `${prefix}${shard.sha256}.json`;
      if (cache) {
        try {
          const response = await cache.match(key);
          if (response) {
            const text = await response.text();
            await verifyShardText(text, shard, signal);
            return text;
          }
        } catch {
          aborted(signal);
          try { await cache.delete(key); } catch { /* Best-effort eviction of an unusable entry. */ }
        }
      }
      aborted(signal);
      const text = await readNetwork();
      await verifyShardText(text, shard, signal);
      if (cache) {
        try { await cache.put(key, new Response(text, { headers: { "Content-Type": "application/json" } })); }
        catch { /* Quota/private-mode failures do not discard verified network data. */ }
      }
      aborted(signal);
      return text;
    },

    /** Call only after the entire snapshot has been decoded and validated. */
    commitGeneration(shards: readonly CachedShard[], signal?: AbortSignal): Promise<void> {
      const current = [...new Set(shards.map(shard => shard.sha256))].sort();
      if (current.some(hash => !HASH.test(hash))) return Promise.reject(new SnapshotFormatError("Invalid shard generation"));
      const operation = commits.catch(() => {}).then(async () => {
        aborted(signal);
        const cache = await open();
        aborted(signal);
        if (!cache) return;
        try {
          let old: Generation | null = null;
          try {
            const response = await cache.match(metadataKey);
            if (response) old = parseGeneration(await response.json());
          } catch { /* Missing/corrupt metadata is not a data-loading failure. */ }
          aborted(signal);
          const same = old && JSON.stringify(current) === JSON.stringify(old.current);
          const generation = { current, previous: same ? old?.previous ?? [] : old?.current ?? [] };
          await cache.put(metadataKey, new Response(JSON.stringify(generation), { headers: { "Content-Type": "application/json" } }));
          const keep = new Set([...generation.current, ...generation.previous].map(hash => `${prefix}${hash}.json`));
          for (const request of await cache.keys()) {
            aborted(signal);
            if (request.url.startsWith(prefix) && request.url !== metadataKey && !keep.has(request.url)) await cache.delete(request);
          }
        } catch {
          aborted(signal);
          // Cache bookkeeping must never invalidate a successfully loaded snapshot.
        }
      });
      commits = operation;
      return operation;
    },
  };
}

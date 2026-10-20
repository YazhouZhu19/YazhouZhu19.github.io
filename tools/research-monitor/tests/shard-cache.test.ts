import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createShardCache } from "../lib/shard-cache";

function memoryStorage() {
  const entries = new Map<string, Response>();
  const key = (value: RequestInfo | URL) => value instanceof Request ? value.url : String(value);
  const cache = {
    async match(value: RequestInfo | URL) { return entries.get(key(value))?.clone(); },
    async put(value: RequestInfo | URL, response: Response) { entries.set(key(value), response.clone()); },
    async delete(value: RequestInfo | URL) { return entries.delete(key(value)); },
    async keys() { return [...entries.keys()].map(url => new Request(url)); },
  };
  return { entries, cache, async open() { return cache; } };
}
function fixture(text: string) {
  const sha256 = createHash("sha256").update(text).digest("hex");
  return { text, shard: { sha256, bytes: Buffer.byteLength(text), path: `papers/${sha256}.json` } };
}

test("verified immutable shards survive a new loader and download only a changed shard", async () => {
  const storage = memoryStorage();
  const one = fixture('[{"id":"one"}]'), two = fixture('[{"id":"two"}]'), updated = fixture('[{"id":"two","updated":true}]');
  let requests = 0;
  async function load(cache: ReturnType<typeof createShardCache>, parts: typeof one[]) {
    const values = await Promise.all(parts.map(part => cache.read(part.shard, async () => { requests++; return part.text; })));
    await cache.commitGeneration(parts.map(part => part.shard));
    return values;
  }
  assert.deepEqual(await load(createShardCache("papers", { storage }), [one, two]), [one.text, two.text]);
  assert.equal(requests, 2);
  assert.deepEqual(await load(createShardCache("papers", { storage }), [one, two]), [one.text, two.text]);
  assert.equal(requests, 2);
  assert.deepEqual(await load(createShardCache("papers", { storage }), [one, updated]), [one.text, updated.text]);
  assert.equal(requests, 3);
});

test("corrupt cached content is reverified, evicted and replaced from the network", async () => {
  const storage = memoryStorage();
  const part = fixture('[{"id":"one"}]');
  const cache = createShardCache("papers", { storage });
  const key = `https://rm-shards.invalid/papers/${part.shard.sha256}.json`;
  await storage.cache.put(key, new Response('[{"id":"bad"}]'));
  let requests = 0;
  assert.equal(await cache.read(part.shard, async () => { requests++; return part.text; }), part.text);
  assert.equal(requests, 1);
  assert.equal(await storage.entries.get(key)?.text(), part.text);
});

test("invalid network bytes never enter the cache", async () => {
  const storage = memoryStorage();
  const part = fixture('[{"id":"one"}]');
  const cache = createShardCache("papers", { storage });
  await assert.rejects(cache.read(part.shard, async () => '[{"id":"bad"}]'), /checksum/);
  assert.equal(storage.entries.size, 0);
});

test("unavailable storage, synchronous denial and quota errors fall back to verified network data", async () => {
  const part = fixture("[]");
  for (const storage of [
    null,
    { open() { throw new Error("Storage denied"); } },
    { async open() { return { ...memoryStorage().cache, async put() { throw new Error("Quota exceeded"); } }; } },
  ]) {
    const cache = createShardCache("papers", { storage });
    assert.equal(await cache.read(part.shard, async () => part.text), part.text);
    await cache.commitGeneration([part.shard]);
  }
});

test("successful generations retain current and previous shards and never prune another namespace", async () => {
  const storage = memoryStorage();
  const cache = createShardCache("papers", { storage });
  const news = createShardCache("signals-news", { storage });
  const parts = [fixture('[{"id":"one"}]'), fixture('[{"id":"two"}]'), fixture('[{"id":"three"}]')];
  await news.read(parts[0].shard, async () => parts[0].text);
  await news.commitGeneration([parts[0].shard]);
  for (const part of parts) {
    await cache.read(part.shard, async () => part.text);
    await cache.commitGeneration([part.shard]);
    await cache.commitGeneration([part.shard]); // Unchanged polling must retain the previous generation.
  }
  const keys = [...storage.entries.keys()];
  assert(!keys.includes(`https://rm-shards.invalid/papers/${parts[0].shard.sha256}.json`));
  assert(keys.includes(`https://rm-shards.invalid/papers/${parts[1].shard.sha256}.json`));
  assert(keys.includes(`https://rm-shards.invalid/papers/${parts[2].shard.sha256}.json`));
  assert(keys.includes(`https://rm-shards.invalid/signals-news/${parts[0].shard.sha256}.json`));
});

test("cancellation cannot publish a partial cache generation or turn into a cache fallback", async () => {
  const storage = memoryStorage();
  const cache = createShardCache("papers", { storage });
  const part = fixture('[{"id":"one"}]');
  const controller = new AbortController();
  const reason = new DOMException("Cancelled", "AbortError");
  await assert.rejects(cache.read(part.shard, async () => { controller.abort(reason); return part.text; }, controller.signal), error => error === reason);
  await assert.rejects(cache.commitGeneration([part.shard], controller.signal), error => error === reason);
  assert.equal(storage.entries.size, 0);
});

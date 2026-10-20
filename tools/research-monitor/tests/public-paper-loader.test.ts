import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPublicPaperLoader, PublicDataLoadError } from "../lib/public-paper-loader";
import { createShardCache } from "../lib/shard-cache";
import { encodeV3Paper } from "../lib/snapshot-v3";
import { PUBLIC_SNAPSHOT_V3_SCHEMA, PUBLIC_SNAPSHOT_SCHEMA, SNAPSHOT_SCHEMA } from "../lib/snapshot";
import type { Paper } from "../lib/types";
import { withPaperClassification } from "../lib/classify";

const base = "https://example.org/research-monitor/";
const now = "2026-10-21T00:00:00.000Z";
function paper(id: string): Paper {
  return {
    id,
    title: `Medical ${id}`,
    abstract: "MRI algorithm",
    authors: [{ name: "A Researcher", affiliations: [] }],
    affiliations: [],
    doi: null,
    source: "arXiv",
    sources: ["arXiv"],
    status: "preprint",
    publishedAt: "2026-10-20",
    updatedAt: null,
    firstSeenAt: now,
    venue: null,
    url: "https://arxiv.org/abs/2601.00001",
    tasks: ["general"],
    modalities: ["MRI"],
    organs: [],
    methods: [],
    humanSignals: [],
    evidence: [],
    tracks: [],
    reviewStatus: "unreviewed",
    provenance: [],
  };
}
function wire(papers: Paper[], schema = PUBLIC_SNAPSHOT_V3_SCHEMA) {
  const records =
    schema === PUBLIC_SNAPSHOT_V3_SCHEMA ? papers.map((paper) => encodeV3Paper(paper, new Map())) : papers;
  const text = JSON.stringify(records) + "\n";
  const sha256 = createHash("sha256").update(text).digest("hex");
  const shard = {
    path: `papers/${sha256}.json`,
    bytes: Buffer.byteLength(text),
    sha256,
    count: papers.length,
    bucket: "2026-10",
  };
  const metadata = {
    totalStored: papers.length,
    collectedAt: now,
    lastSuccessfulSync: now,
    runs: [],
    queryRuns: [],
    coverage: "fixture",
  };
  const manifest = {
    schema,
    metadata,
    totalStored: papers.length,
    shards: [shard],
    ...(schema !== SNAPSHOT_SCHEMA ? { queryUrls: [] } : {}),
    ...(schema === PUBLIC_SNAPSHOT_V3_SCHEMA ? { affiliations: [] } : {}),
  };
  return { manifest, text, shard };
}
const response = (value: unknown, init?: ResponseInit) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), init);
function memoryCache() {
  const rows = new Map<string, Response>();
  const name = (key: RequestInfo | URL) => (key instanceof Request ? key.url : String(key));
  return createShardCache("papers-test", {
    storage: {
      async open() {
        return {
          async match(key: RequestInfo | URL) {
            return rows.get(name(key))?.clone();
          },
          async put(key: RequestInfo | URL, value: Response) {
            rows.set(name(key), value.clone());
          },
          async delete(key: RequestInfo | URL) {
            return rows.delete(name(key));
          },
          async keys() {
            return [...rows.keys()].map((key) => new Request(key));
          },
        };
      },
    },
  });
}

test("public reader decodes v3 and reuses validated data when the manifest returns 304", async () => {
  const input = [paper("one"), paper("two")],
    fixture = wire(input);
  let manifests = 0,
    shards = 0;
  const reader = createPublicPaperLoader(base, {
    shardCache: memoryCache(),
    fetcher: (async (url, init) => {
      if (String(url).endsWith("public-papers-v3.json")) {
        manifests++;
        if (manifests > 1) {
          assert.equal(new Headers(init?.headers).get("If-None-Match"), '"revision-one"');
          return new Response(null, { status: 304 });
        }
        return response(fixture.manifest, { headers: { ETag: '"revision-one"' } });
      }
      shards++;
      return response(fixture.text);
    }) as typeof fetch,
  });
  const first = await reader.load(),
    second = await reader.load();
  assert.deepEqual(first.data.papers, input.map(withPaperClassification));
  assert.equal(second, first);
  assert.equal(manifests, 2);
  assert.equal(shards, 1);
});

for (const failure of ["missing", "manifest", "checksum", "record"] as const) {
  test(`public reader falls back from ${failure} v3 failure only after full validation`, async () => {
    const original = paper("one"),
      v3 = wire([original]),
      v2 = wire([original], PUBLIC_SNAPSHOT_SCHEMA);
    const invalid = wire([{ ...original, title: "" }]);
    const calls: string[] = [];
    const reader = createPublicPaperLoader(base, {
      shardCache: memoryCache(),
      fetcher: (async (url) => {
        const path = String(url);
        calls.push(path);
        if (path.endsWith("public-papers-v3.json")) {
          if (failure === "missing") return response("missing", { status: 404 });
          if (failure === "manifest") return response({ schema: "invalid" });
          return response(failure === "record" ? invalid.manifest : v3.manifest);
        }
        if (path.endsWith("public-papers-v2.json")) return response(v2.manifest);
        if (path.endsWith(v2.shard.path)) return response(v2.text);
        return response(failure === "checksum" ? "invalid bytes" : invalid.text);
      }) as typeof fetch,
    });
    assert.deepEqual((await reader.load()).data.papers, [withPaperClassification(original)]);
    assert.ok(calls.some((path) => path.endsWith("public-papers-v2.json")));
    assert.ok(calls.every((path) => !path.endsWith("/data/papers.json")));
  });
}

test("public reader preserves the v1 endpoint after v3 and v2 fail", async () => {
  const fixture = wire([paper("v1")], SNAPSHOT_SCHEMA);
  const calls: string[] = [];
  const reader = createPublicPaperLoader(base, {
    shardCache: memoryCache(),
    fetcher: (async (url) => {
      const path = String(url);
      calls.push(path);
      if (/public-papers-v[23]\.json$/.test(path)) return response("missing", { status: 404 });
      return response(path.endsWith("/data/papers.json") ? fixture.manifest : fixture.text);
    }) as typeof fetch,
  });
  assert.equal((await reader.load()).data.papers[0].id, "v1");
  assert.deepEqual(
    calls.slice(0, 3).map((path) => path.split("/").at(-1)),
    ["public-papers-v3.json", "public-papers-v2.json", "papers.json"],
  );
});

test("cancellation stops fallback immediately and does not request another endpoint", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const reader = createPublicPaperLoader(base, {
    fetcher: (async (url, init) => {
      calls.push(String(url));
      controller.abort(new DOMException("cancelled", "AbortError"));
      init?.signal?.throwIfAborted();
      throw new Error("unreachable");
    }) as typeof fetch,
  });
  await assert.rejects(reader.load(controller.signal), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("only a changed shard is fetched, and failed refreshes retain the last complete snapshot", async () => {
  const stable = wire([paper("stable")]);
  const old = wire([paper("old")]),
    next = wire([paper("new")]);
  const combine = (changing: ReturnType<typeof wire>) => ({
    ...changing.manifest,
    totalStored: 2,
    metadata: { ...changing.manifest.metadata, totalStored: 2 },
    shards: [stable.shard, changing.shard],
  });
  let revision: "old" | "new" | "fail" = "old";
  const reads: string[] = [];
  const reader = createPublicPaperLoader(base, {
    shardCache: memoryCache(),
    fetcher: (async (url) => {
      const path = String(url);
      if (path.endsWith("public-papers-v3.json") && revision !== "fail")
        return response(combine(revision === "old" ? old : next));
      if (path.endsWith(".json") && !path.includes("/data/papers/"))
        return response("offline", { status: 503 });
      reads.push(path);
      return response(
        path.endsWith(stable.shard.path) ? stable.text : path.endsWith(old.shard.path) ? old.text : next.text,
      );
    }) as typeof fetch,
  });
  await reader.load();
  revision = "new";
  const updated = await reader.load();
  assert.equal(reads.length, 3);
  assert.equal(reads.filter((path) => path.endsWith(stable.shard.path)).length, 1);
  revision = "fail";
  await assert.rejects(
    reader.load(),
    (error: unknown) => error instanceof PublicDataLoadError && error.kind === "network",
  );
  revision = "new";
  assert.equal(await reader.load(), updated);
});

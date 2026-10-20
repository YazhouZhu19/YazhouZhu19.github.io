import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildGitHubDashboard } from "../lib/github-dashboard";
import { buildNewsDashboard, newsDashboardAsOf } from "../lib/news-dashboard";
import { createShardCache } from "../lib/shard-cache";
import {
  createSignalsSnapshotLoader,
  decodeSignalShard,
  encodeSignalShard,
  parseSignalsManifest,
  resolveSignalKind,
} from "../lib/signals-snapshot";
import {
  emptyResearchSignalsData,
  type GitHubSignal,
  type NewsSignal,
  type ResearchSignalsData,
  type SignalSourceState,
} from "../lib/research-signals";
import {
  buildSignalOverviews,
  createSignalsSnapshot,
  readSignalsSnapshot,
  writeSignalsSnapshot,
} from "../scripts/signals-snapshot";

const now = "2026-10-21T04:00:00.000Z";
function repo(name = "a"): GitHubSignal {
  return {
    id: `github:lab/${name}`,
    kind: "github",
    title: name,
    fullName: `lab/${name}`,
    url: `https://github.com/lab/${name}`,
    summary: "医学影像 AI segmentation",
    summaryKind: "repository-description",
    publisher: "lab",
    publishedAt: "2026-10-02T02:00:00Z",
    firstSeenAt: "2026-10-03T02:00:00Z",
    observedAt: now,
    updatedAt: null,
    topics: ["medical-imaging", "segmentation"],
    sourceId: "github-public",
    relatedUrls: [],
    stars: 10,
    forks: 2,
    openIssues: 1,
    license: null,
    language: "Python",
    archived: false,
    pushedAt: "2026-10-21T02:00:00Z",
    releasedAt: null,
    releaseUrl: null,
    readmeExcerpt: "",
  };
}
function news(name = "a"): NewsSignal {
  return {
    id: `news:${name}`,
    kind: "news",
    title: `Medical imaging model ${name}`,
    url: `https://example.org/${name}`,
    summary: "Publisher summary",
    summaryKind: "publisher-excerpt",
    publisher: "Example",
    publishedAt: "2026-10-20T02:00:00Z",
    firstSeenAt: "2026-10-20T03:00:00Z",
    observedAt: now,
    updatedAt: null,
    topics: [],
    sourceId: "news-example",
    relatedUrls: [],
    newsType: "model",
    discoveryUrl: null,
    originalUrl: `https://example.org/${name}`,
  };
}
function source(kind: "github" | "news"): SignalSourceState {
  return {
    id: kind === "github" ? "github-public" : "news-example",
    kind,
    name: kind,
    url: "https://example.org/",
    status: "ok",
    checkedAt: now,
    lastSuccessAt: now,
    received: 1,
    retained: 1,
    error: null,
    coverage: "Public records",
  };
}
function library(): ResearchSignalsData {
  return {
    ...emptyResearchSignalsData(now),
    records: [repo(), { ...repo("b"), publishedAt: "2026-09-01T00:00:00Z" }, news()],
    sources: [source("github"), source("news")],
    discoveryState: {
      github: {
        catalogVersion: "test",
        cursor: 0,
        queue: [],
        completedQueries: 1,
        repositoryCursor: 0,
        cycles: 0,
      },
    },
  };
}
function stripIds(value: any): any {
  if (Array.isArray(value)) return value.map(stripIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["recordIds", "directRecordIds", "candidateRecordIds"].includes(key))
      .map(([key, child]) => [key, stripIds(child)]),
  );
}
function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    entries,
    storage: {
      open: async () => ({
        match: async (input: RequestInfo | URL) => entries.get(String(input))?.clone(),
        put: async (input: RequestInfo | URL, response: Response) => {
          entries.set(String(input), response.clone());
        },
        delete: async (input: RequestInfo | URL) => entries.delete(String(input)),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      }),
    },
  };
}

test("columnar encoding preserves all fields, nulls, missing optional fields, Unicode and ordered arrays", () => {
  const records = [
    repo(),
    {
      ...repo("b"),
      license: "",
      language: null,
      discoveryGroups: [],
      topics: [],
      relevance: { level: "candidate" as const, reasons: ["legacy-unmatched"] },
    },
    {
      ...repo("c"),
      discoveryGroups: ["segmentation"],
      relatedUrls: ["https://example.org/b", "https://example.org/a"],
    },
  ];
  const encoded = JSON.parse(JSON.stringify(encodeSignalShard(records, "github")));
  assert.deepEqual(decodeSignalShard(encoded, "github"), records);
  assert.deepEqual(decodeSignalShard(encodeSignalShard([news()], "news"), "news"), [news()]);
  assert.equal(encoded.rows[0][encoded.columns.indexOf("discoveryGroups")], -1);
  assert.notEqual(encoded.rows[1][encoded.columns.indexOf("discoveryGroups")], -1);
});

test("invalid dictionary references, columns, row widths, duplicate IDs and mixed kinds reject the whole shard", () => {
  const encoded = encodeSignalShard([repo()], "github");
  for (const invalid of [-2, -1, 1, 0.5, "0", null]) {
    const changed = structuredClone(encoded);
    changed.rows[0][changed.columns.indexOf("publisher")] = invalid;
    assert.throws(() => decodeSignalShard(changed, "github"), /dictionary index/);
  }
  assert.throws(() =>
    decodeSignalShard({ ...encoded, columns: ["__proto__", ...encoded.columns.slice(1)] }, "github"),
  );
  assert.throws(() => decodeSignalShard({ ...encoded, rows: [[...encoded.rows[0], null]] }, "github"));
  assert.throws(
    () => decodeSignalShard({ ...encoded, rows: [encoded.rows[0], encoded.rows[0]] }, "github"),
    /duplicate/,
  );
  const changed = structuredClone(encoded);
  changed.dictionaries.kind = ["news"];
  assert.throws(() => decodeSignalShard(changed, "github"));
  assert.throws(() => encodeSignalShard([repo(), news()], "github"), /Mixed/);
});

test("kind/month buckets retain invalid and future dates in undated and old months stay content addressed", () => {
  const data = library();
  data.records.push(
    { ...repo("future"), publishedAt: "2030-01-01T00:00:00Z" },
    { ...repo("invalid"), publishedAt: "2026-02-30T00:00:00Z" },
    { ...repo("missing"), publishedAt: null },
  );
  const first = createSignalsSnapshot(data);
  const undated = first.manifest.shards.find(
    (shard) => shard.kind === "github" && shard.bucket === "undated",
  )!;
  assert.equal(undated.count, 3);
  const next = createSignalsSnapshot({ ...data, records: [...data.records, repo("new")] });
  const oldMonth = first.manifest.shards.find((shard) => shard.bucket === "2026-09")!;
  assert.equal(next.manifest.shards.find((shard) => shard.bucket === "2026-09")!.sha256, oldMonth.sha256);
  assert.equal(next.manifest.shards.find((shard) => shard.bucket === "undated")!.sha256, undated.sha256);
});

test("large buckets split under the byte limit with lossless values and valid kind counts", async () => {
  const data = {
    ...library(),
    records: Array.from({ length: 12 }, (_, i) => ({ ...repo(String(i)), summary: String(i).repeat(300) })),
  };
  const built = createSignalsSnapshot(data, 2000);
  assert.ok(built.manifest.shards.length > 1);
  assert.ok(
    built.manifest.shards.every((shard) => shard.bytes <= 2000 && shard.bucket.startsWith("2026-10.part-")),
  );
  const decoded = await resolveSignalKind(
    built.manifest,
    "github",
    async (shard) => built.texts.get(shard.path)!,
  );
  assert.deepEqual(
    decoded,
    [...data.records].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.throws(() => createSignalsSnapshot(data, 10), /exceeds/);
});

test("precomputed overview values exactly match full browser models at the snapshot instant", () => {
  const data = library();
  data.records.push(
    ...Array.from({ length: 14 }, (_, i) => ({
      ...repo(`rank-${i}`),
      stars: i,
      forks: 20 - i,
      relevance: { level: "direct" as const, reasons: ["medical-imaging"] },
    })),
  );
  const actual = buildSignalOverviews(data);
  const { rows, popularity, ...github } = buildGitHubDashboard(
    data.records,
    {},
    data.generatedAt,
    data.generatedAt,
  );
  const { rows: newsRows, ...newsModel } = buildNewsDashboard(
    data.records,
    {},
    data.generatedAt,
    newsDashboardAsOf(data) ?? "",
  );
  const expectedPopularity = stripIds({
    ...popularity,
    stars: { ...popularity.stars, ranked: popularity.stars.ranked.slice(0, 10) },
    forks: { ...popularity.forks, ranked: popularity.forks.ranked.slice(0, 10) },
  });
  assert.deepEqual(actual.github.model, {
    ...stripIds(github),
    popularity: expectedPopularity,
    rowCount: rows.length,
  });
  assert.deepEqual(actual.news.model, { ...stripIds(newsModel), rowCount: newsRows.length });
  assert.equal(actual.github.model.popularity.stars.ranked.length, 10);
  assert.equal(actual.github.browse.direct, 14);
  assert.equal(actual.news.originalsCount, 1);
  assert.equal(actual.github.recent.length, 4);
});

test("constructing the loader makes no requests, overview loads only the manifest, and kinds load independently with caching", async () => {
  const built = createSignalsSnapshot(library()),
    cache = memoryCache();
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("/research-monitor/data/signals-v2/", "");
    requests.push(path);
    assert.equal(init?.credentials, "omit");
    const body = path === "manifest.json" ? built.manifestText : built.texts.get(path);
    return body === undefined
      ? new Response("", { status: 404 })
      : new Response(body, { headers: { etag: '"v1"' } });
  }) as typeof fetch;
  const options = {
    fetcher,
    caches: {
      github: createShardCache("signals-github", { storage: cache.storage }),
      news: createShardCache("signals-news", { storage: cache.storage }),
    },
  };
  const loader = createSignalsSnapshotLoader(options);
  assert.equal(requests.length, 0);
  const manifest = await loader.loadManifest();
  assert.deepEqual(requests, ["manifest.json"]);
  const repos = await loader.loadKind(manifest, "github");
  assert.equal(repos.length, 2);
  assert.ok(
    requests
      .slice(1)
      .every((path) => manifest.shards.find((shard) => shard.path === path)?.kind === "github"),
  );
  const previousRequests = requests.length;
  assert.deepEqual(await createSignalsSnapshotLoader(options).loadKind(manifest, "github"), repos);
  assert.equal(requests.length, previousRequests);
  assert.equal((await loader.loadKind(manifest, "news")).length, 1);
  assert.equal(requests.length, previousRequests + 1);
});

test("a changed bucket fetches one new shard while unchanged kind buckets stay cached", async () => {
  const data = library(),
    memory = memoryCache();
  let built = createSignalsSnapshot(data),
    requests = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    requests++;
    const path = String(input).replace("/research-monitor/data/signals-v2/", "");
    return new Response(built.texts.get(path)!);
  }) as typeof fetch;
  const loader = createSignalsSnapshotLoader({
    fetcher,
    caches: { github: createShardCache("signals-github", { storage: memory.storage }) },
  });
  await loader.loadKind(built.manifest, "github");
  assert.equal(requests, 2);
  built = createSignalsSnapshot({
    ...data,
    records: data.records.map((record) => (record.id === repo().id ? { ...repo(), stars: 99 } : record)),
  });
  const records = await loader.loadKind(built.manifest, "github");
  assert.equal(requests, 3);
  assert.equal((records.find((record) => record.id === repo().id) as GitHubSignal).stars, 99);
});

test("cancellation during shard reading preserves its reason and never commits a partial generation", async () => {
  const built = createSignalsSnapshot(library()),
    controller = new AbortController();
  const reason = new Error("View changed");
  let commits = 0;
  const cache = {
    read: async (shard: { path: string }) => {
      controller.abort(reason);
      return built.texts.get(shard.path)!;
    },
    commitGeneration: async () => {
      commits++;
    },
  };
  await assert.rejects(
    createSignalsSnapshotLoader({ caches: { github: cache } }).loadKind(
      built.manifest,
      "github",
      controller.signal,
    ),
    (error) => error === reason,
  );
  assert.equal(commits, 0);
});

test("corrupt, absent, cross-kind or incomplete shards never return a partial kind or commit its generation", async () => {
  const built = createSignalsSnapshot(library());
  let commits = 0;
  const cache = {
    read: async (shard: { path: string }) => built.texts.get(shard.path)!.replace("医学影像", "医学图像"),
    commitGeneration: async () => {
      commits++;
    },
  };
  const loader = createSignalsSnapshotLoader({ caches: { github: cache } });
  await assert.rejects(loader.loadKind(built.manifest, "github"), /checksum/);
  assert.equal(commits, 0);
  await assert.rejects(
    resolveSignalKind(built.manifest, "github", async () => {
      throw new Error("missing");
    }),
    /missing/,
  );
  const descriptor = built.manifest.shards.find((shard) => shard.kind === "github")!;
  const mixed = JSON.stringify(encodeSignalShard([news()], "news")) + "\n";
  const patched = {
    ...built.manifest,
    shards: built.manifest.shards.map((shard) =>
      shard === descriptor
        ? {
            ...shard,
            bytes: Buffer.byteLength(mixed),
            sha256: createHash("sha256").update(mixed).digest("hex"),
          }
        : shard,
    ),
  };
  await assert.rejects(
    resolveSignalKind(patched, "github", async (shard) =>
      shard === patched.shards.find((item) => item.path === descriptor.path)
        ? mixed
        : built.texts.get(shard.path)!,
    ),
  );
});

test("manifest paths, duplicate shards, inconsistent counters and overview reference dates are rejected", () => {
  const { manifest } = createSignalsSnapshot(library());
  for (const patch of [
    { path: "../secret.json" },
    { bytes: 4 * 1024 * 1024 + 1 },
    { bucket: "2026-99" },
    { kind: "other" },
  ]) {
    assert.throws(() =>
      parseSignalsManifest({
        ...manifest,
        shards: [{ ...manifest.shards[0], ...patch }, ...manifest.shards.slice(1)],
      }),
    );
  }
  assert.throws(() =>
    parseSignalsManifest({ ...manifest, shards: [...manifest.shards, manifest.shards[0]] }),
  );
  assert.throws(() => parseSignalsManifest({ ...manifest, counts: { github: 3, news: 1 } }));
  const changed = structuredClone(manifest);
  changed.overview.github.model.now = "2000-01-01T00:00:00Z";
  assert.throws(() => parseSignalsManifest(changed));
});

test("atomic writer preserves the previous generation, prunes older orphan shards and leaves valid output on failure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "monitor-signals-v2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "manifest.json");
  const data = library();
  const first = await writeSignalsSnapshot(file, data);
  assert.deepEqual(await readSignalsSnapshot(file), data);
  const second = await writeSignalsSnapshot(file, { ...data, records: [repo("next"), news("next")] });
  const third = await writeSignalsSnapshot(file, { ...data, records: [repo("third"), news("third")] });
  const files = await readdir(join(dir, "shards"));
  assert.deepEqual(
    files.sort(),
    [...new Set([...second.shards, ...third.shards].map((shard) => `${shard.sha256}.json`))].sort(),
  );
  assert.ok(first.shards.some((shard) => !files.includes(`${shard.sha256}.json`)));
  const before = await readFile(file, "utf8");
  await assert.rejects(writeSignalsSnapshot(file, { ...data, records: [repo(), repo()] }));
  assert.equal(await readFile(file, "utf8"), before);
});

test("real signal archive round-trips without dropping fields and publishes a compact overview", async () => {
  const data: ResearchSignalsData = JSON.parse(
    await readFile(new URL("../data/research-signals.json", import.meta.url), "utf8"),
  );
  const built = createSignalsSnapshot(data);
  const github = await resolveSignalKind(
    built.manifest,
    "github",
    async (shard) => built.texts.get(shard.path)!,
  );
  const newsRecords = await resolveSignalKind(
    built.manifest,
    "news",
    async (shard) => built.texts.get(shard.path)!,
  );
  assert.deepEqual(
    [...github, ...newsRecords].sort((a, b) => a.id.localeCompare(b.id)),
    [...data.records].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.ok(
    Buffer.byteLength(built.manifestText) < 1024 * 1024,
    "Overview must remain far smaller than the flat archive",
  );
  assert.ok(
    [...built.texts.values()].reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) <
      Buffer.byteLength(JSON.stringify(data)),
  );
});

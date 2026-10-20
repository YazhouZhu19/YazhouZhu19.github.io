import { z } from "zod";
import {
  GitHubSignalSchema, NewsSignalSchema, ResearchSignalSchema, ResearchSignalsDataSchema,
  SIGNALS_MAX_RECORDS, type GitHubSignal, type NewsSignal, type ResearchSignal, type ResearchSignalsData,
} from "./research-signals";
import { createShardCache, verifyShardText } from "./shard-cache";
import { MAX_SHARD_BYTES, SnapshotFormatError } from "./snapshot";
import { createManifestLoader } from "./manifest-loader";

export const SIGNALS_SNAPSHOT_SCHEMA = "research-monitor-signals-v2";
export type SignalKind = ResearchSignal["kind"];
const kinds = ["github", "news"] as const;
const commonColumns = [
  "id", "kind", "title", "url", "summary", "summaryKind", "publisher", "publishedAt",
  "firstSeenAt", "observedAt", "updatedAt", "topics", "sourceId", "relatedUrls", "discoveryGroups", "relevance",
];
const extraColumns = {
  github: ["fullName", "stars", "forks", "openIssues", "license", "language", "archived", "pushedAt", "releasedAt", "releaseUrl", "readmeExcerpt"],
  news: ["newsType", "discoveryUrl", "originalUrl"],
};
const dictionaryColumns = new Set([
  "kind", "summaryKind", "publisher", "firstSeenAt", "observedAt", "updatedAt", "topics", "sourceId",
  "discoveryGroups", "relevance", "license", "language", "archived", "newsType",
]);
const optionalColumns = new Set(["discoveryGroups", "relevance"]);
export type SignalColumnarShard = {
  columns: string[];
  dictionaries: Record<string, unknown[]>;
  rows: unknown[][];
};

/** Dictionaries belong to one shard, so refreshing metadata cannot rewrite old buckets. */
export function encodeSignalShard(records: readonly ResearchSignal[], kind: SignalKind): SignalColumnarShard {
  const columns = [...commonColumns, ...extraColumns[kind]];
  const dictionaries: Record<string, unknown[]> = {};
  const indices = new Map<string, Map<string, number>>();
  for (const name of columns) if (dictionaryColumns.has(name)) {
    dictionaries[name] = [];
    indices.set(name, new Map());
  }
  const rows = records.map(record => {
    ResearchSignalSchema.parse(record);
    if (record.kind !== kind) throw new SnapshotFormatError("Mixed signal kinds in one shard");
    return columns.map(name => {
      const value = (record as unknown as Record<string, unknown>)[name];
      if (dictionaryColumns.has(name)) {
        if (value === undefined && optionalColumns.has(name)) return -1;
        const key = JSON.stringify(value), values = indices.get(name)!;
        let index = values.get(key);
        if (index === undefined) {
          index = dictionaries[name].length;
          dictionaries[name].push(value);
          values.set(key, index);
        }
        return index;
      }
      return value;
    });
  });
  return { columns, dictionaries, rows };
}

export function decodeSignalShard(raw: unknown, kind: SignalKind): ResearchSignal[] {
  const payload = raw as SignalColumnarShard;
  const expected = [...commonColumns, ...extraColumns[kind]];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).sort().join(",") !== "columns,dictionaries,rows"
    || JSON.stringify(payload.columns) !== JSON.stringify(expected)
    || !payload.dictionaries || typeof payload.dictionaries !== "object" || Array.isArray(payload.dictionaries)
    || !Array.isArray(payload.rows) || payload.rows.length > SIGNALS_MAX_RECORDS) {
    throw new SnapshotFormatError("Invalid columnar signal shard");
  }
  const names = expected.filter(name => dictionaryColumns.has(name)).sort();
  if (Object.keys(payload.dictionaries).sort().join(",") !== names.join(",")
    || names.some(name => !Array.isArray(payload.dictionaries[name])
      || payload.dictionaries[name].length > SIGNALS_MAX_RECORDS)) {
    throw new SnapshotFormatError("Invalid signal dictionary");
  }
  const seen = new Set<string>();
  return payload.rows.map(row => {
    if (!Array.isArray(row) || row.length !== expected.length) throw new SnapshotFormatError("Invalid signal column count");
    const decoded: Record<string, unknown> = {};
    expected.forEach((name, index) => {
      const value = row[index];
      if (!dictionaryColumns.has(name)) { decoded[name] = value; return; }
      if (value === -1 && optionalColumns.has(name)) return;
      const dictionary = payload.dictionaries[name];
      if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= dictionary.length) {
        throw new SnapshotFormatError("Invalid signal dictionary index");
      }
      decoded[name] = dictionary[value as number];
    });
    const record = ResearchSignalSchema.parse(decoded);
    if (record.kind !== kind || seen.has(record.id)) throw new SnapshotFormatError("Mixed signal kinds or duplicate signal IDs");
    seen.add(record.id);
    return record;
  });
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const short = z.string().max(500);
const nullableTime = z.string().max(40).nullable();
const bucket = z.object({ id: short, labelZh: short, labelEn: short, count }).strict();
const distribution = z.array(bucket).max(1000);
const seriesRow = z.object({
  date: z.string().max(10), count: count.nullable(), direct: count.nullable(), candidate: count.nullable(),
  isToday: z.boolean(), observed: z.boolean(),
}).strict();
const scoped = z.object({
  kind: z.enum(kinds), asOf: z.string().max(40), referenceDateValid: z.boolean(), total: count,
  metrics: distribution, categories: distribution,
  timeline: z.object({ months: distribution, missing: bucket, future: bucket, older: bucket }).strict(),
  languages: distribution, maintenance: distribution, newsTypes: distribution, publishers: distribution,
}).strict();
const commonModel = {
  global: z.object({ total: bucket, today: bucket, initial: bucket }).strict(),
  scoped, series: z.array(seriesRow).max(400), seriesGranularity: z.enum(["day", "month"]),
  today: nullableTime, start: nullableTime, end: nullableTime, observedFrom: nullableTime, observedTo: nullableTime,
  initialAt: nullableTime, initialDay: nullableTime, initialInScope: bucket, now: nullableTime,
  asOf: nullableTime, snapshotDay: nullableTime, snapshotStale: z.boolean(), snapshotInFuture: z.boolean(),
  referenceDateValid: z.boolean(), nowValid: z.boolean(), rangeValid: z.boolean(), rowCount: count,
};
const popularityStats = z.object({
  total: count, median: z.number().nonnegative().nullable(), count, hasVariation: z.boolean(),
  ranked: z.array(z.object({ record: GitHubSignalSchema, rank: count, value: count }).strict()).max(10),
}).strict();
const githubModel = z.object({
  ...commonModel, filters: z.object({ range: z.literal(30), clock: z.literal("activity") }).strict(),
  excluded: z.object({ missing: bucket, future: bucket, outside: bucket, unavailable: bucket }).strict(),
  popularity: z.object({
    stars: popularityStats, forks: popularityStats, observedFrom: nullableTime, observedTo: nullableTime, observedCount: count,
  }).strict(),
}).strict();
const newsModel = z.object({
  ...commonModel, filters: z.object({ range: z.literal(30), clock: z.literal("publication") }).strict(),
  excluded: z.object({ initial: bucket, missing: bucket, future: bucket, outside: bucket, unavailable: bucket }).strict(),
}).strict();
const browse = z.object({
  direct: count, candidate: count, publishers: count,
  categories: z.record(count), discoveryGroups: z.record(count),
}).strict();
const githubOverview = z.object({
  model: githubModel, recent: z.array(GitHubSignalSchema).max(4), browse,
}).strict();
const newsOverview = z.object({
  model: newsModel, recent: z.array(NewsSignalSchema).max(4), originalsCount: count, browse,
}).strict();
export type GitHubSignalOverview = z.infer<typeof githubOverview>;
export type NewsSignalOverview = z.infer<typeof newsOverview>;
export type SignalShard = {
  kind: SignalKind; bucket: string; path: string; count: number; bytes: number; sha256: string;
};
export type SignalsManifest = Omit<ResearchSignalsData, "schemaVersion" | "records"> & {
  schemaVersion: 2; schema: typeof SIGNALS_SNAPSHOT_SCHEMA;
  counts: Record<SignalKind, number>;
  shards: SignalShard[];
  overview: { github: GitHubSignalOverview; news: NewsSignalOverview };
};

export function parseSignalsManifest(raw: unknown): SignalsManifest {
  const value = raw as SignalsManifest;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== SIGNALS_SNAPSHOT_SCHEMA || value.schemaVersion !== 2
    || Object.keys(value).some(key => !["schema", "schemaVersion", "generatedAt", "sources", "limitations", "discoveryState", "counts", "shards", "overview"].includes(key))
    || !value.counts || Object.keys(value.counts).sort().join(",") !== "github,news"
    || !Array.isArray(value.shards) || value.shards.length > SIGNALS_MAX_RECORDS
    || !value.overview || Object.keys(value.overview).sort().join(",") !== "github,news") {
    throw new SnapshotFormatError("Invalid signal snapshot manifest");
  }
  const metadata = ResearchSignalsDataSchema.parse({
    schemaVersion: 1, generatedAt: value.generatedAt, sources: value.sources, limitations: value.limitations,
    ...(value.discoveryState === undefined ? {} : { discoveryState: value.discoveryState }), records: [],
  });
  const counted = { github: 0, news: 0 }, paths = new Set<string>();
  for (const shard of value.shards) {
    if (!shard || typeof shard !== "object" || Array.isArray(shard)
      || Object.keys(shard).sort().join(",") !== "bucket,bytes,count,kind,path,sha256"
      || !kinds.includes(shard.kind) || !/^(?:undated|\d{4}-(?:0[1-9]|1[0-2]))(?:\.part-[1-9]\d*)?$/.test(shard.bucket)
      || !/^[a-f0-9]{64}$/.test(shard.sha256) || shard.path !== `shards/${shard.sha256}.json`
      || !Number.isSafeInteger(shard.count) || shard.count < 1
      || !Number.isSafeInteger(shard.bytes) || shard.bytes < 1 || shard.bytes > MAX_SHARD_BYTES || paths.has(shard.path)) {
      throw new SnapshotFormatError("Invalid signal shard descriptor");
    }
    counted[shard.kind] += shard.count;
    paths.add(shard.path);
  }
  const overview = {
    github: githubOverview.parse(value.overview.github),
    news: newsOverview.parse(value.overview.news),
  };
  if (counted.github + counted.news > SIGNALS_MAX_RECORDS) throw new SnapshotFormatError("Too many signal records");
  for (const kind of kinds) {
    const model = overview[kind].model, browser = overview[kind].browse;
    if (value.counts[kind] !== counted[kind] || model.global.total.count !== counted[kind]
      || model.scoped.kind !== kind || model.rowCount !== model.scoped.total
      || browser.direct + browser.candidate !== counted[kind]
      || Date.parse(model.now ?? "") !== Date.parse(value.generatedAt)) throw new SnapshotFormatError("Signal summary counts or reference time differ");
  }
  const { records: _records, schemaVersion: _version, ...rest } = metadata;
  return { ...rest, schemaVersion: 2, schema: SIGNALS_SNAPSHOT_SCHEMA, counts: { ...value.counts }, shards: value.shards, overview };
}

export function signalSnapshotData(manifest: SignalsManifest, records: ResearchSignal[]): ResearchSignalsData {
  return ResearchSignalsDataSchema.parse({
    schemaVersion: 1, generatedAt: manifest.generatedAt, sources: manifest.sources, limitations: manifest.limitations,
    ...(manifest.discoveryState === undefined ? {} : { discoveryState: manifest.discoveryState }), records,
  });
}

export async function resolveSignalKind(
  manifest: SignalsManifest, kind: SignalKind, readShard: (shard: SignalShard) => Promise<string>, signal?: AbortSignal,
): Promise<ResearchSignal[]> {
  const descriptors = manifest.shards.filter(shard => shard.kind === kind);
  const parts: ResearchSignal[][] = new Array(descriptors.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(4, descriptors.length) }, async () => {
    while (!failed) {
      signal?.throwIfAborted();
      const index = next++;
      if (index >= descriptors.length) return;
      try {
        const shard = descriptors[index], text = await readShard(shard);
        await verifyShardText(text, shard, signal);
        parts[index] = decodeSignalShard(JSON.parse(text), kind);
        if (parts[index].length !== shard.count) throw new SnapshotFormatError("Signal shard count differs");
      } catch (error) { failed = true; throw error; }
    }
  }));
  signal?.throwIfAborted();
  const records = parts.flat().sort((a, b) => a.id.localeCompare(b.id));
  if (records.length !== manifest.counts[kind]) throw new SnapshotFormatError("Signal kind count differs");
  signalSnapshotData(manifest, records); // Validate duplicate IDs and source relationships across every shard.
  return records;
}

async function readText(response: Response, limit: number, signal?: AbortSignal): Promise<string> {
  if (!response.ok) throw new Error("Signal shard request failed");
  if (Number(response.headers.get("content-length")) > limit) throw new SnapshotFormatError("Signal shard is too large");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > limit) throw new SnapshotFormatError("Signal shard is too large");
    signal?.throwIfAborted();
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new SnapshotFormatError("Signal shard is too large"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export function createSignalsSnapshotLoader(options: {
  baseUrl?: string; fetcher?: typeof fetch;
  caches?: Partial<Record<SignalKind, ReturnType<typeof createShardCache>>>;
} = {}) {
  const root = `${(options.baseUrl ?? "/research-monitor/").replace(/\/?$/, "/")}data/signals-v2/`;
  const fetcher = options.fetcher ?? fetch;
  const manifestLoader = createManifestLoader<SignalsManifest>(`${root}manifest.json`, {
    fetcher, validate: parseSignalsManifest, maxBytes: MAX_SHARD_BYTES,
  });
  const caches = {
    github: options.caches?.github ?? createShardCache("signals-github"),
    news: options.caches?.news ?? createShardCache("signals-news"),
  };
  return {
    loadManifest: manifestLoader.load,
    async loadKind(manifest: SignalsManifest, kind: SignalKind, signal?: AbortSignal): Promise<ResearchSignal[]> {
      const records = await resolveSignalKind(manifest, kind, shard => caches[kind].read(shard, async () => {
        const response = await fetcher(`${root}${shard.path}`, { signal, credentials: "omit", cache: "force-cache" });
        return readText(response, shard.bytes, signal);
      }, signal), signal);
      await caches[kind].commitGeneration(manifest.shards.filter(shard => shard.kind === kind), signal);
      signal?.throwIfAborted();
      return records;
    },
  };
}

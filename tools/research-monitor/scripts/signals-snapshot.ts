import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { githubQualitySummary, matureGitHubRecords } from "../lib/github-quality";
import { buildGitHubDashboard, githubDashboardDate } from "../lib/github-dashboard";
import { buildNewsDashboard, newsDashboardAsOf, newsDashboardDate } from "../lib/news-dashboard";
import { getSignalBrowseCategoryIds } from "../lib/signal-browse-categories";
import {
  parseResearchSignalsData,
  safeSignalUrl,
  type GitHubSignal,
  type NewsSignal,
  type ResearchSignal,
  type ResearchSignalsData,
} from "../lib/research-signals";
import {
  SIGNALS_SNAPSHOT_SCHEMA,
  decodeSignalShard,
  encodeSignalShard,
  parseSignalsManifest,
  resolveSignalKind,
  signalSnapshotData,
  type SignalKind,
  type SignalShard,
  type SignalsManifest,
} from "../lib/signals-snapshot";
import { MAX_SHARD_BYTES } from "../lib/snapshot";
import { snapshotBucket } from "./snapshot-buckets";

/** Aggregate transport has no full-population record lists; drill-through loads the kind first. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["rows", "recordIds", "directRecordIds", "candidateRecordIds"].includes(key))
      .map(([key, item]) => [
        key,
        compact(key === "ranked" && Array.isArray(item) ? item.slice(0, 10) : item),
      ]),
  );
}

function browseSummary(records: ResearchSignal[]) {
  const categories: Record<string, number> = Object.create(null),
    discoveryGroups: Record<string, number> = Object.create(null);
  const increment = (target: Record<string, number>, key: string) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  for (const record of records) {
    for (const id of new Set(getSignalBrowseCategoryIds(record))) increment(categories, id);
    for (const id of record.discoveryGroups ?? []) increment(discoveryGroups, id);
  }
  const direct = records.filter((record) => record.relevance?.level === "direct").length;
  const publishers = new Set(
    records
      .map((record) => record.publisher.trim().toLocaleLowerCase("en"))
      .filter((name) => name && !/^(unknown|unspecified|n\/?a|none|null|未知|未注明|未提供)$/.test(name)),
  ).size;
  return { direct, candidate: records.length - direct, publishers, categories, discoveryGroups };
}

function recent<T extends ResearchSignal>(records: T[], date: (record: T) => string | null): T[] {
  return [...records]
    .sort(
      (left, right) =>
        (Date.parse(date(right) ?? "") || 0) - (Date.parse(date(left) ?? "") || 0) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 4);
}

/** Same functions and defaults as the browser, evaluated at the snapshot instant. */
export function buildSignalOverviews(data: ResearchSignalsData): SignalsManifest["overview"] {
  const github = buildGitHubDashboard(
    data.records,
    { baseRecords: matureGitHubRecords(data.records, data.generatedAt) },
    data.generatedAt,
    data.generatedAt,
  );
  const news = buildNewsDashboard(data.records, {}, data.generatedAt, newsDashboardAsOf(data) ?? "");
  return {
    github: {
      quality: githubQualitySummary(data.records, data.generatedAt),
      model: {
        ...(compact(github) as SignalsManifest["overview"]["github"]["model"]),
        rowCount: github.rows.length,
      },
      recent: recent(github.rows, (record) => githubDashboardDate(record, "activity")),
      browse: browseSummary(data.records.filter((record) => record.kind === "github")),
    },
    news: {
      model: {
        ...(compact(news) as SignalsManifest["overview"]["news"]["model"]),
        rowCount: news.rows.length,
      },
      recent: recent(news.rows, (record) => newsDashboardDate(record, "publication")),
      originalsCount: news.rows.filter((record) => safeSignalUrl(record.originalUrl)).length,
      browse: browseSummary(data.records.filter((record) => record.kind === "news")),
    },
  };
}

export function createSignalsSnapshot(input: ResearchSignalsData, maxBytes = MAX_SHARD_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 3 || maxBytes > MAX_SHARD_BYTES)
    throw new Error("Invalid signal shard limit");
  const data = parseResearchSignalsData(input);
  const groups = new Map<string, { kind: SignalKind; bucket: string; records: ResearchSignal[] }>();
  for (const record of data.records) {
    const bucket = snapshotBucket(record.publishedAt, data.generatedAt),
      key = `${record.kind}/${bucket}`;
    const group = groups.get(key) ?? { kind: record.kind, bucket, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  const shards: SignalShard[] = [],
    texts = new Map<string, string>();
  const counts = { github: 0, news: 0 };
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const records = group.records.sort((a, b) => a.id.localeCompare(b.id));
    const parts: { text: string; count: number }[] = [];
    function split(rows: ResearchSignal[]) {
      const text = JSON.stringify(encodeSignalShard(rows, group.kind)) + "\n";
      if (Buffer.byteLength(text) <= maxBytes) {
        parts.push({ text, count: rows.length });
        return;
      }
      if (rows.length < 2) throw new Error(`Signal ${rows[0]?.id} exceeds the shard limit`);
      const middle = Math.ceil(rows.length / 2);
      split(rows.slice(0, middle));
      split(rows.slice(middle));
    }
    split(records);
    for (const [index, part] of parts.entries()) {
      const sha256 = createHash("sha256").update(part.text).digest("hex"),
        path = `shards/${sha256}.json`;
      shards.push({
        path,
        sha256,
        bytes: Buffer.byteLength(part.text),
        count: part.count,
        kind: group.kind,
        bucket: parts.length === 1 ? group.bucket : `${group.bucket}.part-${index + 1}`,
      });
      counts[group.kind] += part.count;
      texts.set(path, part.text);
    }
  }
  const { records: _records, schemaVersion: _version, ...metadata } = data;
  const manifest = parseSignalsManifest({
    ...metadata,
    schema: SIGNALS_SNAPSHOT_SCHEMA,
    schemaVersion: 2,
    counts,
    shards,
    overview: buildSignalOverviews(data),
  });
  const manifestText = JSON.stringify(manifest) + "\n";
  if (Buffer.byteLength(manifestText) > MAX_SHARD_BYTES)
    throw new Error("Signal overview manifest exceeds 4 MiB");
  // Grouping changes transport order only. Every record and metadata field is
  // checked without a lossy projection, in the collector's canonical ID order.
  const decoded = shards
    .flatMap((shard) => decodeSignalShard(JSON.parse(texts.get(shard.path)!), shard.kind))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    signalSnapshotData(manifest, decoded),
    {
      ...input,
      records: [...input.records].sort((a, b) => a.id.localeCompare(b.id)),
    },
    "Columnar signal transport changed collected fields or metadata",
  );
  return { manifest, manifestText, texts };
}

export async function readSignalsSnapshot(file: string): Promise<ResearchSignalsData> {
  const manifest = parseSignalsManifest(JSON.parse(await readFile(file, "utf8")));
  const readShard = (shard: SignalShard) => readFile(join(dirname(file), shard.path), "utf8");
  const records = [
    ...(await resolveSignalKind(manifest, "github", readShard)),
    ...(await resolveSignalKind(manifest, "news", readShard)),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return signalSnapshotData(manifest, records);
}

/** Publish only verified content and preserve the previous generation for clients spanning deployments. */
export async function writeSignalsSnapshot(
  file: string,
  input: ResearchSignalsData,
  previousFile = file,
  maxBytes = MAX_SHARD_BYTES,
): Promise<SignalsManifest> {
  const { manifest, manifestText, texts } = createSignalsSnapshot(input, maxBytes);
  let previous: SignalsManifest | undefined;
  try {
    previous = parseSignalsManifest(JSON.parse(await readFile(previousFile, "utf8")));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(join(dirname(file), "shards"), { recursive: true });
  for (const [path, text] of texts) {
    const target = join(dirname(file), path),
      temporary = target + ".tmp";
    await writeFile(temporary, text);
    await rename(temporary, target);
  }
  if (previous && resolve(dirname(previousFile)) !== resolve(dirname(file))) {
    for (const shard of previous.shards) {
      await copyFile(join(dirname(previousFile), shard.path), join(dirname(file), shard.path));
    }
  }
  await writeFile(file + ".tmp", manifestText);
  await rename(file + ".tmp", file);
  const keep = new Set([...manifest.shards, ...(previous?.shards ?? [])].map((shard) => shard.path));
  for (const name of await readdir(join(dirname(file), "shards"))) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(`shards/${name}`))
      await unlink(join(dirname(file), "shards", name));
  }
  assert.deepEqual(await readSignalsSnapshot(file), {
    ...input,
    records: [...input.records].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return manifest;
}

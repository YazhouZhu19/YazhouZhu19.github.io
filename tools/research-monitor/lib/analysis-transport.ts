import {
  ANALYSIS_MANIFEST_SCHEMA,
  ANALYSIS_SNAPSHOT_MAX_BYTES,
  parseAnalysisManifest,
  parseAnalysisSnapshot,
  type AnalysisManifest,
  type AnalysisSnapshot,
} from "./analysis-snapshot";

export const ANALYSIS_TRANSPORT_SCHEMA = "oevryn-analysis-packed-v2";
export const ANALYSIS_MANIFEST_V2_SCHEMA = "oevryn-analysis-manifest-v2";
export const ANALYSIS_TRANSPORT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE = 7000,
  MAX_TEXTS = 2000,
  MAX_NODES = 100000,
  MAX_DEPTH = 32;
type EvidenceTuple = [string, "paper" | "github" | "news", string, string, string];
type TextTuple = [string, string];
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type AnalysisTransport = {
  schema: typeof ANALYSIS_TRANSPORT_SCHEMA;
  evidence: EvidenceTuple[];
  texts: TextTuple[];
  snapshot: JsonValue;
};
export type AnalysisManifestV2 = Omit<AnalysisManifest, "schema"> & {
  schema: typeof ANALYSIS_MANIFEST_V2_SCHEMA;
  contentSha256: string;
};
const textEncoder = new TextEncoder();
const bytes = (value: string) => textEncoder.encode(value).byteLength;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function evidenceTuple(value: Record<string, unknown>): EvidenceTuple | null {
  return keys(value, ["excerpt", "id", "kind", "title", "url"])
    ? ([value.id, value.kind, value.title, value.url, value.excerpt] as EvidenceTuple)
    : null;
}
function textTuple(value: Record<string, unknown>): TextTuple | null {
  return keys(value, ["en", "zh"]) ? ([value.zh, value.en] as TextTuple) : null;
}

/** Pool repeated evidence and bilingual strings without changing the analysis model. */
export function encodeAnalysisTransport(input: AnalysisSnapshot): AnalysisTransport {
  const snapshot = parseAnalysisSnapshot(input);
  const evidence = new Map<string, EvidenceTuple>(),
    texts = new Map<string, TextTuple>();
  function collect(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!object(value)) return;
    const e = evidenceTuple(value),
      t = textTuple(value);
    if (e) evidence.set(JSON.stringify(e), e);
    else if (t) texts.set(JSON.stringify(t), t);
    else Object.values(value).forEach(collect);
  }
  collect(snapshot);
  const evidencePool = [...evidence.values()].sort(
    (a, b) =>
      order(a[1], b[1]) || order(a[0], b[0]) || order(a[4], b[4]) || order(a[2], b[2]) || order(a[3], b[3]),
  );
  const textPool = [...texts.values()].sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
  const evidenceIndex = new Map(evidencePool.map((entry, index) => [JSON.stringify(entry), index]));
  const textIndex = new Map(textPool.map((entry, index) => [JSON.stringify(entry), index]));
  function encode(value: unknown): JsonValue {
    if (Array.isArray(value)) return value.map(encode);
    if (object(value)) {
      const e = evidenceTuple(value),
        t = textTuple(value);
      if (e) return { $e: evidenceIndex.get(JSON.stringify(e))! };
      if (t) return { $t: textIndex.get(JSON.stringify(t))! };
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([key, v]) => [key, encode(v)]),
      );
    }
    return value as JsonValue;
  }
  const packed: AnalysisTransport = {
    schema: ANALYSIS_TRANSPORT_SCHEMA,
    evidence: evidencePool,
    texts: textPool,
    snapshot: encode(snapshot),
  };
  if (bytes(JSON.stringify(packed)) > ANALYSIS_TRANSPORT_MAX_BYTES)
    throw new Error("Analysis transport exceeds its size limit");
  // Build failures surface here, rather than publishing a payload the browser cannot read.
  parseAnalysisTransport(packed);
  return packed;
}

/** Reject malformed/ambiguous references and bound both encoded and expanded data. */
export function parseAnalysisTransport(raw: unknown): AnalysisSnapshot {
  if (
    !object(raw) ||
    !keys(raw, ["evidence", "schema", "snapshot", "texts"]) ||
    raw.schema !== ANALYSIS_TRANSPORT_SCHEMA
  )
    throw new Error("Unsupported analysis transport");
  if (
    !Array.isArray(raw.evidence) ||
    raw.evidence.length > MAX_EVIDENCE ||
    !Array.isArray(raw.texts) ||
    raw.texts.length > MAX_TEXTS
  )
    throw new Error("Invalid analysis dictionaries");
  const evidence: EvidenceTuple[] = [],
    texts: TextTuple[] = [],
    evidenceSizes: number[] = [],
    textSizes: number[] = [];
  const uniqueEvidence = new Set<string>(),
    uniqueTexts = new Set<string>();
  let dictionaryBytes = 0;
  for (const entry of raw.evidence) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 5 ||
      entry.some((value) => typeof value !== "string") ||
      !["paper", "github", "news"].includes(entry[1]) ||
      !entry[0] ||
      entry[0].length > 500 ||
      !entry[2] ||
      entry[2].length > 20000 ||
      entry[3].length > 12000 ||
      entry[4].length > 520000
    )
      throw new Error("Invalid analysis evidence dictionary");
    const encoded = JSON.stringify(entry);
    if (uniqueEvidence.has(encoded)) throw new Error("Duplicate analysis evidence dictionary entry");
    uniqueEvidence.add(encoded);
    dictionaryBytes += bytes(encoded);
    evidence.push(entry as EvidenceTuple);
    evidenceSizes.push(
      bytes(
        JSON.stringify({ id: entry[0], kind: entry[1], title: entry[2], url: entry[3], excerpt: entry[4] }),
      ),
    );
  }
  for (const entry of raw.texts) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      entry.some((value) => typeof value !== "string" || !value || value.length > 2000)
    )
      throw new Error("Invalid analysis text dictionary");
    const encoded = JSON.stringify(entry);
    if (uniqueTexts.has(encoded)) throw new Error("Duplicate analysis text dictionary entry");
    uniqueTexts.add(encoded);
    dictionaryBytes += bytes(encoded);
    texts.push(entry as TextTuple);
    textSizes.push(bytes(JSON.stringify({ zh: entry[0], en: entry[1] })));
  }
  if (dictionaryBytes > ANALYSIS_TRANSPORT_MAX_BYTES)
    throw new Error("Analysis dictionaries exceed the size limit");
  const usedEvidence = new Set<number>(),
    usedTexts = new Set<number>();
  let nodes = 0,
    expandedBytes = 0;
  function charge(count: number) {
    expandedBytes += count;
    if (expandedBytes > ANALYSIS_SNAPSHOT_MAX_BYTES)
      throw new Error("Expanded analysis exceeds the size limit");
  }
  function decode(value: unknown, depth: number): JsonValue {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      throw new Error("Analysis structure exceeds the size limit");
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid analysis number");
      charge(bytes(JSON.stringify(value)));
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw new Error("Analysis array exceeds the size limit");
      charge(2 + Math.max(0, value.length - 1));
      return value.map((item) => decode(item, depth + 1));
    }
    if (!object(value)) throw new Error("Invalid analysis value");
    const props = Object.keys(value);
    if (props.includes("$e") || props.includes("$t")) {
      const key = props[0],
        index = value[key];
      if (
        props.length !== 1 ||
        (key !== "$e" && key !== "$t") ||
        !Number.isSafeInteger(index) ||
        (index as number) < 0
      )
        throw new Error("Invalid analysis dictionary reference");
      const i = index as number;
      if (key === "$e") {
        if (i >= evidence.length) throw new Error("Analysis evidence reference is out of range");
        usedEvidence.add(i);
        charge(evidenceSizes[i]);
        const e = evidence[i];
        return { id: e[0], kind: e[1], title: e[2], url: e[3], excerpt: e[4] };
      }
      if (i >= texts.length) throw new Error("Analysis text reference is out of range");
      usedTexts.add(i);
      charge(textSizes[i]);
      const t = texts[i];
      return { zh: t[0], en: t[1] };
    }
    charge(2 + Math.max(0, props.length - 1));
    const result: Record<string, JsonValue> = {};
    for (const key of props) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Invalid analysis property");
      charge(bytes(JSON.stringify(key)) + 1);
      result[key] = decode(value[key], depth + 1);
    }
    return result;
  }
  const snapshot = decode(raw.snapshot, 0);
  if (usedEvidence.size !== evidence.length || usedTexts.size !== texts.length)
    throw new Error("Unused analysis dictionary entry");
  if (bytes(JSON.stringify(raw)) > ANALYSIS_TRANSPORT_MAX_BYTES)
    throw new Error("Analysis transport exceeds its size limit");
  return parseAnalysisSnapshot(snapshot);
}

/** Stable calculation identity ignores build time and physical shard/dictionary layout only. */
export function stableAnalysisContent(snapshot: AnalysisSnapshot): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (object(value))
      return `{${Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`;
    return JSON.stringify(value);
  }
  return canonical({
    result: snapshot.result,
    sources: {
      papers: {
        collectedAt: snapshot.sources.papers.collectedAt,
        totalStored: snapshot.sources.papers.totalStored,
      },
      signals: {
        generatedAt: snapshot.sources.signals.generatedAt,
        totalStored: snapshot.sources.signals.totalStored,
        states: snapshot.sources.signals.states,
      },
    },
  });
}

export function parseAnalysisManifestV2(raw: unknown): AnalysisManifestV2 {
  if (
    !object(raw) ||
    raw.schema !== ANALYSIS_MANIFEST_V2_SCHEMA ||
    typeof raw.contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.contentSha256)
  )
    throw new Error("Unsupported analysis manifest");
  const { contentSha256, schema: _schema, ...rest } = raw;
  const parsed = parseAnalysisManifest({ ...rest, schema: ANALYSIS_MANIFEST_SCHEMA });
  if (parsed.snapshotBytes > ANALYSIS_TRANSPORT_MAX_BYTES)
    throw new Error("Analysis transport exceeds its size limit");
  return { ...parsed, schema: ANALYSIS_MANIFEST_V2_SCHEMA, contentSha256 };
}

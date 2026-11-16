import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ANALYSIS_TRANSPORT_MAX_BYTES,
  encodeAnalysisTransport,
  parseAnalysisTransport,
  parseAnalysisManifestV2,
  stableAnalysisContent,
} from "../lib/analysis-transport";
import { parseAnalysisSnapshot, type AnalysisSnapshot } from "../lib/analysis-snapshot";
import { createAnalysisSnapshot } from "../scripts/analysis-snapshot";
import { createAnalysisManifestV2 } from "../scripts/analysis-transport";
import { monitorDataSchema } from "../lib/public-data-schema";
import { normalizeRecord } from "../lib/record";
import { emptyResearchSignalsData } from "../lib/research-signals";

const at = "2026-11-17T00:00:00.000Z";
const description =
  "We address limited annotations with U-Net for brain MRI segmentation. Experiments evaluate a benchmark. Results achieve Dice of 0.9. Dataset available at https://zenodo.org/records/123. Code https://github.com/lab/brain.";
function fixture(): AnalysisSnapshot {
  const papers = Array.from({ length: 43 }, (_, i) =>
    normalizeRecord(
      {
        id: `transport:${i}`,
        title: i < 3 ? "Brain MRI segmentation" : "Medical MRI reconstruction",
        abstract: i < 3 ? description : "Deep learning MRI reconstruction method from undersampled k-space.",
        originalAbstract:
          i < 3 ? description : "Deep learning MRI reconstruction method from undersampled k-space.",
        authors: [],
        doi: `10.1000/transport-${i}`,
        source: "Europe PMC",
        status: "published",
        publishedAt: i < 2 ? `${2023 + i}-01-01` : "2026-01-01",
        firstSeenAt: at,
        url: `https://example.org/transport/${i}`,
        provenance: [],
      },
      at,
    ),
  );
  const data = monitorDataSchema.parse({
    papers,
    totalStored: papers.length,
    collectedAt: at,
    lastSuccessfulSync: at,
    runs: [],
    queryRuns: [],
    coverage: "Synthetic codec fixture",
    status: "ok",
  });
  const signals = emptyResearchSignalsData(at);
  signals.sources = [
    {
      id: "fixture",
      kind: "github",
      name: "Fixture",
      url: "https://example.org",
      status: "ok",
      checkedAt: at,
      lastSuccessAt: at,
      received: 0,
      retained: 0,
      error: null,
      coverage: "Synthetic codec fixture",
    },
  ];
  return createAnalysisSnapshot({
    papers: data,
    signals,
    generatedAt: at,
    paperManifestSha256: "a".repeat(64),
    signalsManifestSha256: "b".repeat(64),
  });
}
const original = fixture();
const packed = encodeAnalysisTransport(original);
const clonePacked = () => structuredClone(packed);
function contentHash(snapshot: AnalysisSnapshot): string {
  return createHash("sha256").update(stableAnalysisContent(snapshot)).digest("hex");
}
function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  return value;
}

test("compact transport restores every result, source state and metadata field without mutating the input", () => {
  assert.ok(original.result.niches.length > 0, "Fixture must exercise niche evidence and gaps");
  assert.ok(packed.evidence.length > 0 && packed.texts.length > 0);
  const before = JSON.stringify(original);
  const restored = parseAnalysisTransport(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(restored, original);
  assert.deepEqual(encodeAnalysisTransport(original), packed);
  assert.equal(JSON.stringify(original), before);
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(before));
  const byId = restored.result.directions.flatMap((direction) => [
    ...direction.evidence,
    ...Object.values(direction.facets).flatMap((facets) => facets.flatMap((facet) => facet.evidence)),
  ]);
  const repeated = byId.find(
    (item, i) => byId.findIndex((other) => other.id === item.id && other.excerpt === item.excerpt) < i,
  )!;
  const first = byId.find((item) => item.id === repeated.id && item.excerpt === repeated.excerpt)!;
  assert.ok(repeated, "Fixture must exercise reused evidence");
  assert.notEqual(first, repeated, "Dictionary references must restore independent objects");
  first.title = "Changed by a consumer";
  assert.notEqual(first.title, repeated.title);
  assert.equal(JSON.stringify(original), before);
});

test("content identity ignores only build time and physical manifest layout", () => {
  const equivalent = structuredClone(original);
  equivalent.generatedAt = "2026-11-17T12:00:00.000Z";
  equivalent.sources.papers.manifestSha256 = "c".repeat(64);
  equivalent.sources.signals.manifestSha256 = "d".repeat(64);
  assert.deepEqual(parseAnalysisSnapshot(equivalent), equivalent);
  assert.equal(contentHash(equivalent), contentHash(original));
  assert.equal(stableAnalysisContent(reverseKeys(original)), stableAnalysisContent(original));
  const mutations: Array<(snapshot: AnalysisSnapshot) => void> = [
    (s) => {
      s.result.directions[0].label.zh += "更新";
    },
    (s) => {
      s.result.directions.reverse();
    },
    (s) => {
      s.result.niches[0].evidence[0].excerpt += " Evidence changed.";
    },
    (s) => {
      s.result.asOf = "2026-11-18";
    },
    (s) => {
      s.result.totals.paper++;
    },
    (s) => {
      s.sources.papers.collectedAt = "2026-11-16T00:00:00.000Z";
    },
    (s) => {
      s.sources.papers.totalStored++;
    },
    (s) => {
      s.sources.signals.generatedAt = "2026-11-16T00:00:00.000Z";
    },
    (s) => {
      s.sources.signals.totalStored++;
    },
    (s) => {
      s.sources.signals.states[0].coverage += " Changed";
    },
    (s) => {
      s.sources.signals.states[0].status = "error";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(contentHash(changed), contentHash(original), `Ignored meaningful change: ${mutate}`);
  }
});

test("rejects malformed, ambiguous, out-of-range or duplicate dictionary entries", () => {
  const mutations: Array<(value: any) => void> = [
    (v) => {
      v.schema = "other";
    },
    (v) => {
      v.extra = true;
    },
    (v) => {
      v.evidence[0] = ["invalid"];
    },
    (v) => {
      v.texts[0] = ["", "English"];
    },
    (v) => {
      v.evidence.push(v.evidence[0]);
    },
    (v) => {
      v.texts.push(v.texts[0]);
    },
    (v) => {
      v.evidence.push(["unused", "paper", "Unused", "https://example.org", "unused"]);
    },
    (v) => {
      v.texts.push(["未引用", "Unused"]);
    },
    ...[-1, 0.1, "0", NaN, Number.MAX_SAFE_INTEGER + 1, packed.texts.length].map((index) => (v: any) => {
      v.snapshot.result.directions[0].label = { $t: index };
    }),
    (v) => {
      v.snapshot.result.directions[0].label = { $t: 0, extra: true };
    },
    (v) => {
      v.snapshot.result.directions[0].label = { $t: 0, $e: 0 };
    },
    (v) => {
      v.snapshot.result.directions[0].evidence = [{ $e: v.evidence.length }];
    },
    (v) => {
      v.snapshot.result.directions[0].evidence = [{ $e: -1 }];
    },
    (v) => {
      v.snapshot.result.directions[0].evidence = [{ $e: 0.5 }];
    },
    (v) => {
      v.snapshot.result.directions[0].evidence = [{ $e: 0, extra: true }];
    },
    (v) => {
      v.snapshot.result.niches[0].evidenceStatus = "unsupported";
    },
    (v) => {
      v.snapshot.result.totals.paper = -1;
    },
    (v) => {
      v.evidence[0][3] = "javascript:alert(1)";
    },
  ];
  for (const mutate of mutations) {
    const value = clonePacked();
    mutate(value);
    assert.throws(() => parseAnalysisTransport(value), `Accepted malformed transport: ${mutate}`);
  }
});

test("rejects expansion bombs, excess dictionaries, large arrays and deep/cyclic structures before schema parsing", () => {
  const hugeEvidence = ["bomb", "paper", "Bomb", "https://example.org", "x".repeat(520000)];
  assert.throws(
    () =>
      parseAnalysisTransport({
        ...packed,
        evidence: [hugeEvidence],
        texts: [],
        snapshot: Array.from({ length: 17 }, () => ({ $e: 0 })),
      }),
    /Expanded analysis exceeds/,
  );
  assert.throws(
    () => parseAnalysisTransport({ ...packed, evidence: Array(7001).fill(hugeEvidence) }),
    /dictionaries/,
  );
  assert.throws(
    () => parseAnalysisTransport({ ...packed, texts: Array(2001).fill(["中", "English"]) }),
    /dictionaries/,
  );
  assert.throws(
    () => parseAnalysisTransport({ ...packed, snapshot: Array(100001).fill(null) }),
    /array exceeds/,
  );
  assert.throws(
    () =>
      parseAnalysisTransport({
        ...packed,
        evidence: [],
        texts: [],
        snapshot: "x".repeat(ANALYSIS_TRANSPORT_MAX_BYTES),
      }),
    /transport exceeds/,
  );
  let nested: any = null;
  for (let i = 0; i < 34; i++) nested = { nested };
  assert.throws(() => parseAnalysisTransport({ ...packed, snapshot: nested }), /structure exceeds/);
  const cycle: any = {};
  cycle.cycle = cycle;
  assert.throws(() => parseAnalysisTransport({ ...packed, snapshot: cycle }), /structure exceeds/);
  assert.throws(
    () => parseAnalysisTransport({ ...packed, snapshot: JSON.parse('{"__proto__":{}}') }),
    /Invalid analysis property/,
  );
});

test("v2 manifest separates exact payload integrity from stable calculation identity", () => {
  const text = JSON.stringify(packed) + "\n";
  const manifest = createAnalysisManifestV2(original, text);
  assert.deepEqual(parseAnalysisManifestV2(JSON.parse(JSON.stringify(manifest))), manifest);
  assert.equal(manifest.snapshotBytes, Buffer.byteLength(text));
  assert.equal(manifest.snapshotSha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(manifest.contentSha256, contentHash(original));
  const republished = structuredClone(original);
  republished.generatedAt = "2026-11-17T12:00:00.000Z";
  republished.sources.papers.manifestSha256 = "e".repeat(64);
  const nextManifest = createAnalysisManifestV2(
    republished,
    JSON.stringify(encodeAnalysisTransport(republished)) + "\n",
  );
  assert.notEqual(nextManifest.snapshotSha256, manifest.snapshotSha256);
  assert.equal(nextManifest.contentSha256, manifest.contentSha256);
  assert.notDeepEqual(nextManifest.sources, manifest.sources);
  for (const patch of [
    { schema: "other" },
    { contentSha256: "not a hash" },
    { contentSha256: "A".repeat(64) },
    { contentSha256: undefined },
    { extra: true },
    { snapshotBytes: ANALYSIS_TRANSPORT_MAX_BYTES + 1 },
    { snapshotSha256: "bad" },
  ])
    assert.throws(() => parseAnalysisManifestV2({ ...manifest, ...patch }));
});

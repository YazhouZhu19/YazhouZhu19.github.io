import { z } from "zod";
import { ANALYSIS_RULE_VERSION } from "./analysis-version";
import { SignalSourceStateSchema, type SignalSourceState } from "./research-signals";
import type { AnalysisResult } from "./integrated-analysis";

export const ANALYSIS_SNAPSHOT_SCHEMA = "oevryn-analysis-v1";
export const ANALYSIS_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const ANALYSIS_MANIFEST_SCHEMA = "oevryn-analysis-manifest-v1";
// Kept independent of the algorithm module so reading a summary does not load its rules.
const ruleVersion = ANALYSIS_RULE_VERSION;
const directionIds = [
  "segmentation",
  "diagnosis",
  "reconstruction",
  "registration",
  "generation",
  "foundation",
  "prediction",
];
export type AnalysisSnapshot = {
  schema: typeof ANALYSIS_SNAPSHOT_SCHEMA;
  generatedAt: string;
  sources: {
    papers: { collectedAt: string; totalStored: number; manifestSha256: string };
    signals: {
      generatedAt: string;
      totalStored: number;
      manifestSha256: string;
      states: SignalSourceState[];
    };
  };
  result: AnalysisResult;
};
const count = z.number().int().nonnegative().max(1000000);
const timestamp = z.string().max(40).datetime({ offset: true });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, "Invalid calendar date");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.object({ zh: z.string().min(1).max(2000), en: z.string().min(1).max(2000) }).strict();
const kinds = ["paper", "github", "news"] as const;
const counts = z.object({ paper: count, github: count, news: count }).strict();
const ratio = z.number().finite().min(0).max(1);
const evidence = z
  .object({
    id: z.string().min(1).max(500),
    kind: z.enum(kinds),
    title: z.string().min(1).max(20000),
    url: z
      .string()
      .max(12000)
      .url()
      .refine((value) => /^https?:\/\//i.test(value)),
    excerpt: z.string().max(520000),
  })
  .strict();
const facet = z.object({ label: text, counts, evidence: z.array(evidence).max(9) }).strict();
const direction = z
  .object({
    id: z.string().min(1).max(100),
    label: text,
    counts,
    shares: z.object({ paper: ratio, github: ratio, news: ratio }).strict(),
    score: ratio,
    mainstream: z.boolean(),
    facets: z
      .object({
        problems: z.array(facet).max(7),
        methods: z.array(facet).max(7),
        scenarios: z.array(facet).max(7),
      })
      .strict(),
    evidence: z.array(evidence).max(9),
  })
  .strict();
const niche = z
  .object({
    id: z.string().min(1).max(300),
    label: text,
    count,
    share: ratio,
    years: z.array(z.number().int().min(1).max(9999)).max(10000),
    spanDays: z.number().finite().nonnegative(),
    logicPapers: count,
    data: z.array(evidence).max(3),
    code: z.array(evidence).max(5),
    news: z.array(evidence).max(5),
    dataSpanDays: z.number().finite().nonnegative(),
    ready: z.boolean(),
    evidenceStatus: z.enum(["sufficient", "pending"]),
    gaps: z.array(text).max(4),
    evidence: z.array(evidence).max(3),
  })
  .strict();
const resultSchema = z
  .object({
    version: z.literal(ruleVersion),
    historyTotal: count,
    windowStart: day,
    totals: counts,
    unmatched: counts,
    excluded: counts,
    duplicates: counts,
    directions: z.array(direction).length(directionIds.length),
    niches: z.array(niche).max(343),
    asOf: day,
  })
  .strict();
const schema = z
  .object({
    schema: z.literal(ANALYSIS_SNAPSHOT_SCHEMA),
    generatedAt: timestamp,
    sources: z
      .object({
        papers: z.object({ collectedAt: timestamp, totalStored: count, manifestSha256: hash }).strict(),
        signals: z
          .object({
            generatedAt: timestamp,
            totalStored: count,
            manifestSha256: hash,
            states: z.array(SignalSourceStateSchema).max(160),
          })
          .strict(),
      })
      .strict(),
    result: resultSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const reject = (message: string) => ctx.addIssue({ code: "custom", message });
    const { result: result, sources } = value;
    const generated = Date.parse(value.generatedAt);
    if (!Number.isFinite(generated) || !Number.isFinite(Date.parse(result.asOf))) return;
    if (result.asOf !== new Date(generated).toISOString().slice(0, 10))
      reject("Analysis date differs from its UTC generation date");
    const windowStart = new Date(Date.parse(result.asOf) - 364 * 86400000).toISOString().slice(0, 10);
    if (result.windowStart !== windowStart) reject("Analysis window differs from the supported rule window");
    if (
      Date.parse(sources.papers.collectedAt) > generated ||
      Date.parse(sources.signals.generatedAt) > generated
    )
      reject("Analysis cannot predate its input snapshots");
    if (result.historyTotal + result.excluded.paper + result.duplicates.paper !== sources.papers.totalStored)
      reject("Paper accounting differs from the source snapshot");
    if (
      result.totals.paper > result.historyTotal ||
      result.totals.github +
        result.totals.news +
        result.excluded.github +
        result.excluded.news +
        result.duplicates.github +
        result.duplicates.news >
        sources.signals.totalStored
    )
      reject("Analysis counts exceed the source population");
    if (new Set(sources.signals.states.map((source) => source.id)).size !== sources.signals.states.length)
      reject("Duplicate source state IDs");
    if (
      new Set(result.directions.map((entry) => entry.id)).size !== directionIds.length ||
      result.directions.some((entry) => !directionIds.includes(entry.id))
    )
      reject("Invalid direction IDs");
    if (new Set(result.niches.map((entry) => entry.id)).size !== result.niches.length)
      reject("Duplicate niche IDs");
    for (const kind of kinds)
      if (result.unmatched[kind] > result.totals[kind]) reject("Unmatched count exceeds its denominator");
    const equalRatio = (a: number, b: number) => Math.abs(a - b) < 1e-12;
    for (const entry of result.directions) {
      for (const kind of kinds) {
        if (entry.counts[kind] > result.totals[kind]) reject("Direction count exceeds its denominator");
        if (
          !equalRatio(entry.shares[kind], result.totals[kind] ? entry.counts[kind] / result.totals[kind] : 0)
        )
          reject("Direction share differs from its count");
        for (const facet of Object.values(entry.facets).flat())
          if (facet.counts[kind] > entry.counts[kind]) reject("Facet count exceeds its direction");
      }
      if (!equalRatio(entry.score, kinds.reduce((sum, kind) => sum + entry.shares[kind], 0) / 3))
        reject("Direction score differs from its shares");
    }
    for (const entry of result.niches) {
      if (
        !entry.count ||
        entry.count > result.historyTotal ||
        entry.logicPapers > entry.count ||
        entry.share >= 0.1 ||
        !equalRatio(entry.share, entry.count / result.historyTotal)
      )
        reject("Invalid niche population");
      if (
        entry.ready !== (entry.evidenceStatus === "sufficient") ||
        entry.ready !== (entry.gaps.length === 0)
      )
        reject("Niche evidence state contradicts its gaps");
      if (
        entry.years.some(
          (year, i) => year > Number(result.asOf.slice(0, 4)) || (i > 0 && year <= entry.years[i - 1]),
        )
      )
        reject("Invalid niche publication years");
    }
  });

/** Validate an atomic result with its own source metadata; never mix publication generations. */
export function parseAnalysisSnapshot(raw: unknown): AnalysisSnapshot {
  return schema.parse(raw);
}

export type AnalysisManifest = {
  schema: typeof ANALYSIS_MANIFEST_SCHEMA;
  generatedAt: string;
  asOf: string;
  ruleVersion: string;
  snapshotSha256: string;
  snapshotBytes: number;
  sources: {
    papers: AnalysisSnapshot["sources"]["papers"];
    signals: Omit<AnalysisSnapshot["sources"]["signals"], "states">;
  };
};
const manifestSchema = z
  .object({
    schema: z.literal(ANALYSIS_MANIFEST_SCHEMA),
    generatedAt: timestamp,
    asOf: day,
    ruleVersion: z.literal(ruleVersion),
    snapshotSha256: hash,
    snapshotBytes: z.number().int().positive().max(ANALYSIS_SNAPSHOT_MAX_BYTES),
    sources: z
      .object({
        papers: z.object({ collectedAt: timestamp, totalStored: count, manifestSha256: hash }).strict(),
        signals: z.object({ generatedAt: timestamp, totalStored: count, manifestSha256: hash }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const generated = Date.parse(value.generatedAt);
    if (!Number.isFinite(generated)) return;
    if (value.asOf !== new Date(generated).toISOString().slice(0, 10))
      ctx.addIssue({ code: "custom", message: "Analysis date differs from its UTC generation date" });
    if (
      Date.parse(value.sources.papers.collectedAt) > generated ||
      Date.parse(value.sources.signals.generatedAt) > generated
    )
      ctx.addIssue({ code: "custom", message: "Analysis cannot predate its input snapshots" });
  });

export function parseAnalysisManifest(raw: unknown): AnalysisManifest {
  return manifestSchema.parse(raw);
}

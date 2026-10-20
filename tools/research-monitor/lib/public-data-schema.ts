import { z } from "zod";
import { withPaperClassification } from "./classify";
import { normalizePaperPublicationDate } from "./publication-date";

// Public snapshots are validated independently from personal browser data.
const shortText = z.string().max(2000);
const labels = z.array(shortText).max(500);
const publicUrl = z
  .string()
  .max(12000)
  .url()
  .refine((value) => /^https?:\/\//i.test(value));
const dateText = z
  .string()
  .max(40)
  .refine((value) => value === "" || Number.isFinite(Date.parse(value)));
const timestamp = z.string().max(40).datetime({ offset: true });
const count = z.number().int().nonnegative();
const paperSchema = z
  .object({
    id: z.string().min(1).max(500),
    title: z.string().min(1).max(20000),
    abstract: z.string().max(500000),
    authors: z
      .array(
        z.object({
          name: shortText,
          displayName: shortText.optional(),
          orcid: shortText.nullable().optional(),
          affiliations: labels,
        }),
      )
      .max(5000),
    affiliations: labels,
    doi: shortText.nullable(),
    pmid: shortText.nullable().optional(),
    arxivId: shortText.nullable().optional(),
    source: shortText,
    sources: labels,
    sourceCollection: shortText.optional(),
    status: z.enum(["preprint", "published", "unknown"]),
    publishedAt: dateText,
    dateAnomaly: z.literal("future").optional(),
    updatedAt: dateText.nullable(),
    firstSeenAt: timestamp,
    venue: shortText.nullable(),
    url: publicUrl,
    version: z.union([z.number().finite(), shortText]).nullable().optional(),
    relatedDoi: shortText.nullable().optional(),
    versions: z
      .array(
        z.object({
          id: shortText.optional(),
          source: shortText.optional(),
          versionNumber: z.union([z.number().finite(), shortText]).optional(),
          firstPublishDate: dateText.optional(),
        }),
      )
      .max(1000)
      .optional(),
    tasks: labels,
    modalities: labels,
    organs: labels,
    methods: labels,
    humanSignals: labels,
    evidence: z.array(z.object({ label: shortText, excerpt: z.string().max(20000) })).max(500),
    tracks: labels,
    scope: z.enum(["core", "adjacent", "out"]).optional(),
    scopeReasons: labels.optional(),
    scopeClassifierVersion: shortText.optional(),
    taskClassifierVersion: shortText.optional(),
    reviewStatus: shortText,
    provenance: z
      .array(
        z.object({
          queryUrl: publicUrl.optional(),
          queryTrack: shortText.optional(),
          collectedAt: timestamp,
          sourceRecordId: shortText.optional(),
          publicationDates: z
            .object({
              firstPublicationDate: z.string().max(2000).nullable().optional(),
              electronicPublicationDate: z.string().max(2000).nullable().optional(),
              firstIndexDate: z.string().max(2000).nullable().optional(),
            })
            .optional(),
          publicationDateField: z
            .enum(["firstPublicationDate", "electronicPublicationDate", "firstIndexDate"])
            .optional(),
        }),
      )
      .max(10000),
  })
  .transform(withPaperClassification);
const runSchema = z.object({
  id: shortText,
  source: shortText,
  startedAt: timestamp,
  completedAt: timestamp,
  status: z.enum(["ok", "partial", "error"]),
  received: count,
  kept: count,
  added: count,
  updated: count,
  total: count.nullable(),
  query: z.string().max(50000),
  dateFrom: dateText,
  dateTo: dateText,
  error: z.string().max(10000).optional(),
  coverage: z.string().max(10000),
});
const querySchema = z.object({
  source: shortText,
  track: shortText,
  retrieved: count,
  hitCount: count.nullable(),
  startDate: dateText,
  endDate: dateText,
  dateField: shortText,
  query: z.string().max(50000),
  collectedAt: timestamp,
  url: publicUrl.optional(),
});
export const monitorDataSchema = z
  .object({
    totalStored: count.optional(),
    interestTaxonomyVersion: shortText.optional(),
    scopeClassifierVersion: shortText.optional(),
    sourceTaxonomyVersions: z
      .record(shortText, shortText)
      .refine((value) => Object.keys(value).length <= 1000, "Too many source taxonomy versions")
      .optional(),
    papers: z.array(paperSchema).max(100000),
    runs: z.array(runSchema).max(10000),
    queryRuns: z.array(querySchema).max(10000),
    collectedAt: timestamp,
    storageAvailable: z.boolean().optional(),
    error: z.string().max(10000).optional(),
    lastSuccessfulSync: timestamp.nullable(),
    coverage: z.string().max(10000),
  })
  .transform((data) => ({
    ...data,
    papers: data.papers.map((paper) => normalizePaperPublicationDate(paper, data.collectedAt)),
  }));
export type VerifiedPublicData = z.infer<typeof monitorDataSchema>;

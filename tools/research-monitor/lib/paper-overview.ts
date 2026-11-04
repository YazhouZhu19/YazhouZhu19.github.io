import { z } from "zod";
import { publicPaperFieldsSchema, monitorDataSchema } from "./public-data-schema";
import { decodeV3Paper } from "./snapshot-v3";
import type { DashboardData } from "./dashboard-base";

export const PAPER_OVERVIEW_SCHEMA = "oevryn-paper-overview-v1";
export const overviewFields = {
  id: true,
  title: true,
  url: true,
  authors: true,
  doi: true,
  relatedDoi: true,
  pmid: true,
  arxivId: true,
  source: true,
  sources: true,
  status: true,
  publishedAt: true,
  dateAnomaly: true,
  firstSeenAt: true,
  tracks: true,
  tasks: true,
  modalities: true,
  methods: true,
} as const;
export const overviewPaperSchema = publicPaperFieldsSchema.pick(overviewFields).extend({
  scope: z.enum(["core", "adjacent", "out"]),
  provenance: z.array(z.object({ sourceRecordId: z.string().max(2000).optional() })).max(10000),
});
export type OverviewPaper = z.infer<typeof overviewPaperSchema>;
export type PaperOverviewData = DashboardData<OverviewPaper>;

/** This is explicitly a dashboard projection, never a complete paper or AI evidence. */
export function parsePaperOverview(raw: unknown): PaperOverviewData {
  const envelope = z
    .object({
      schema: z.literal(PAPER_OVERVIEW_SCHEMA),
      metadata: z.record(z.unknown()),
      affiliations: z.array(z.string().max(2000)).max(100000),
      records: z.array(z.unknown()).max(100000),
    })
    .parse(raw);
  const metadata = monitorDataSchema.parse({ ...envelope.metadata, papers: [] });
  const papers = envelope.records.map((record) =>
    overviewPaperSchema.parse(decodeV3Paper(record, envelope.affiliations)),
  );
  if (metadata.totalStored !== papers.length || new Set(papers.map((p) => p.id)).size !== papers.length)
    throw new Error("Invalid paper overview record count");
  return { ...metadata, storageAvailable: metadata.storageAvailable ?? false, papers };
}

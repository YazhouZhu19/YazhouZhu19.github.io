import { encodeV3Paper } from "../lib/snapshot-v3";
import { monitorDataSchema } from "../lib/public-data-schema";
import {
  PAPER_OVERVIEW_SCHEMA,
  overviewFields,
  overviewPaperSchema,
  parsePaperOverview,
} from "../lib/paper-overview";

/** Compute classifications and project dashboard fields once, during publication. */
export function createPaperOverview(raw: unknown) {
  const { papers, ...metadata } = monitorDataSchema.parse(raw);
  const records = papers.map((paper) =>
    overviewPaperSchema.parse({
      ...Object.fromEntries(
        Object.keys(overviewFields).map((key) => [key, paper[key as keyof typeof paper]]),
      ),
      scope: paper.scope,
      provenance: [
        ...new Set(paper.provenance.map((p) => p.sourceRecordId).filter((id): id is string => !!id)),
      ].map((sourceRecordId) => ({ sourceRecordId })),
    }),
  );
  const affiliations = [...new Set(records.flatMap((p) => p.authors.flatMap((a) => a.affiliations)))].sort();
  const dictionary = new Map(affiliations.map((value, index) => [value, index]));
  const output = {
    schema: PAPER_OVERVIEW_SCHEMA,
    metadata: { ...metadata, totalStored: records.length, queryRuns: [] },
    affiliations,
    records: records.map((record) => encodeV3Paper(record, dictionary)),
  };
  parsePaperOverview(output);
  return output;
}

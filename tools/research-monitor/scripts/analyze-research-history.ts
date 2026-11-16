import { writeFile } from "node:fs/promises";
import { readSnapshotFile } from "./snapshot-files";
import { readHistoryPacks } from "./research-history-files";
import { analyzeLongitudinalHistory, HISTORY_THRESHOLDS } from "../lib/longitudinal-analysis";
import type { Paper } from "../lib/types";

const snapshot = await readSnapshotFile("data/papers.json");
const { packs, fingerprints } = await readHistoryPacks();
const history = analyzeLongitudinalHistory({ packs, papers: snapshot.papers as Paper[], asOf: "2026-11-17" });
// The native app ships the same reviewed, dated snapshot as the offline page.
// Only sanitized views are published; original abstracts stay in the evidence packs.
await writeFile("data/analysis-history.json", JSON.stringify(history) + "\n");
await writeFile(
  "docs/research-history-audit.json",
  JSON.stringify(
    {
      inputSnapshotCollectedAt: snapshot.collectedAt,
      thresholds: HISTORY_THRESHOLDS,
      fingerprints,
      history,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      version: history.version,
      asOf: history.asOf,
      basePaperCount: history.basePaperCount,
      enrichedPaperCount: history.enrichedPaperCount,
      directions: history.directions.map((d) => ({
        id: d.id,
        evidenceStatus: d.evidenceStatus,
        archiveCount: d.archiveCount,
        papers: d.papers.length,
        logicPapers: d.papers.filter((p) => p.logicComplete).length,
        checks: d.checks.map(({ id, passed }) => ({ id, passed })),
      })),
    },
    null,
    2,
  ),
);

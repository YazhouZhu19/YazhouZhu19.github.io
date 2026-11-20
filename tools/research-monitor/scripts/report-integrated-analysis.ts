import { writeFile } from "node:fs/promises";
import { readSnapshotFile } from "./snapshot-files";
import { analyzeResearch } from "../lib/integrated-analysis";
import type { Paper } from "../lib/types";
import { readSignalArchiveFile } from "./signal-archive";
const data = await readSnapshotFile("data/papers.json");
const signals = await readSignalArchiveFile("data/research-signals.json");
const start = performance.now();
const result = analyzeResearch({
  papers: data.papers as Paper[],
  signals: signals.records,
  asOf: "2026-11-16",
});
const report = {
  version: result.version,
  asOf: result.asOf,
  windowStart: result.windowStart,
  historyTotal: result.historyTotal,
  collectedAt: data.collectedAt,
  signalsGeneratedAt: signals.generatedAt,
  elapsedMs: Math.round(performance.now() - start),
  totals: result.totals,
  excluded: result.excluded,
  duplicates: result.duplicates,
  unmatched: result.unmatched,
  directions: result.directions.map(({ evidence, facets, ...d }) => ({
    ...d,
    facets: Object.fromEntries(Object.entries(facets).map(([k, v]) => [k, v.slice(0, 3)])),
  })),
  nicheCount: result.niches.length,
  readyNicheCount: result.niches.filter((n) => n.ready).length,
  niches: result.niches.slice(0, 10),
};
await writeFile("docs/integrated-analysis-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      elapsedMs: report.elapsedMs,
      totals: report.totals,
      historyTotal: report.historyTotal,
      nicheCount: report.nicheCount,
      readyNicheCount: report.readyNicheCount,
      directions: report.directions.map((d) => ({
        name: d.label.zh,
        score: d.score,
        mainstream: d.mainstream,
      })),
    },
    null,
    2,
  ),
);

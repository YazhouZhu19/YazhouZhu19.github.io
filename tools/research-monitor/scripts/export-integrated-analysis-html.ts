import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSnapshotFile } from "./snapshot-files";
import { analyzeResearch } from "../lib/integrated-analysis";
import { analyzePaperCodeLinks } from "../lib/paper-code-links";
import { readSignalArchiveFile } from "./signal-archive";
import type { Paper } from "../lib/types";
import { analyzeLongitudinalHistory } from "../lib/longitudinal-analysis";
import { readHistoryPacks } from "./research-history-files";
const data = await readSnapshotFile("data/papers.json");
const signals = await readSignalArchiveFile("data/research-signals.json");
const { packs, fingerprints } = await readHistoryPacks();
const history = analyzeLongitudinalHistory({ packs, papers: data.papers as Paper[], asOf: "2026-11-17" });
const result = analyzeResearch({
  papers: data.papers as Paper[],
  signals: signals.records,
  asOf: history.asOf,
});
const paperCodeLinks = analyzePaperCodeLinks({
  papers: data.papers as Paper[],
  signals: signals.records,
  asOf: result.asOf,
});
const payload = {
  exportVersion: "2026-11-17-offline-v3",
  history,
  historyFingerprints: fingerprints,
  result,
  paperCodeLinks,
  collectedAt: data.collectedAt,
  signalsGeneratedAt: signals.generatedAt,
  inputPapers: data.papers.length,
  inputSignals: signals.records.length,
  sourceStates: signals.sources.map(({ name, status, lastSuccessAt }) => ({ name, status, lastSuccessAt })),
};
// JSON is text in a script element. Escape HTML delimiters and Unicode line separators.
const json = JSON.stringify(payload)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
const template = await readFile("scripts/templates/integrated-analysis-offline.html", "utf8");
if (template.split("__ANALYSIS_DATA__").length !== 2)
  throw new Error("Expected exactly one data placeholder");
const output = resolve(process.argv[2] || "../../../OEVRYN-分析-多年积累与证据.html");
await writeFile(
  output,
  template.replace("__ANALYSIS_DATA__", () => json),
);
console.log(
  JSON.stringify(
    {
      output,
      bytes: Buffer.byteLength(template.replace("__ANALYSIS_DATA__", () => json)),
      directions: result.directions.length,
      niches: result.niches.length,
      qualified: result.niches.filter((n) => n.ready).length,
      historyDirections: history.directions.length,
      historyPapers: history.enrichedPaperCount,
      historySufficient: history.directions.filter((d) => d.evidenceStatus === "sufficient").length,
      associations: paperCodeLinks.stats,
    },
    null,
    2,
  ),
);

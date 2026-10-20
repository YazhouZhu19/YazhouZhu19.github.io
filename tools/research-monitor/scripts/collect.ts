import { resolve } from "node:path";
import { collectAll } from "../lib/collect";
import { parseMonitorData } from "../lib/record";
import { reclassifyPapers, SCOPE_CLASSIFIER_VERSION, TASK_CLASSIFIER_VERSION } from "../lib/classify";
import { normalizePaperPublicationDate } from "../lib/publication-date";
import { readSnapshotFile, writeSnapshotFile } from "./snapshot-files";
import type { Paper } from "../lib/types";

function argumentsFor(argv: string[]) {
  let input = "data/papers.json",
    output = "data/papers.json",
    reclassifyOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: tsx scripts/collect.ts [--input data/papers.json] [--output data/papers.json] [--reclassify-only]",
      );
      process.exit(0);
    }
    if (flag === "--reclassify-only") {
      reclassifyOnly = true;
      continue;
    }
    if (!["--input", "--output"].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error(`未知参数或缺少参数值：${flag}`);
    if (flag === "--input") input = argv[++index];
    else output = argv[++index];
  }
  return { input: resolve(input), output: resolve(output), reclassifyOnly };
}

async function main() {
  const { input, output, reclassifyOnly } = argumentsFor(process.argv.slice(2));
  // Missing/invalid input is fatal. Never silently replace the public library with an empty one.
  const snapshot = await readSnapshotFile(input);
  if (reclassifyOnly) {
    // A migration must not merge IDs or fabricate source/successful-sync timestamps.
    const papers = reclassifyPapers<Paper>(snapshot.papers).map((paper) =>
      normalizePaperPublicationDate(paper, snapshot.collectedAt),
    );
    const reclassified = {
      ...snapshot,
      papers,
      scopeClassifierVersion: SCOPE_CLASSIFIER_VERSION,
      taskClassifierVersion: TASK_CLASSIFIER_VERSION,
    };
    await writeSnapshotFile(output, reclassified);
    console.log(
      `Reclassified ${papers.length} retained papers; scope=${SCOPE_CLASSIFIER_VERSION}; tasks=${TASK_CLASSIFIER_VERSION}`,
    );
    return;
  }
  const previous = parseMonitorData(snapshot);
  const { data, allFailed, outcomes } = await collectAll(previous);
  const classifiedData = {
    ...data,
    scopeClassifierVersion: SCOPE_CLASSIFIER_VERSION,
    taskClassifierVersion: TASK_CLASSIFIER_VERSION,
  };
  await writeSnapshotFile(output, classifiedData);
  for (const { run } of outcomes) {
    const stored = data.runs.find((candidate) => candidate.id === run.id)!;
    console.log(
      JSON.stringify({
        source: stored.source,
        status: stored.status,
        received: stored.received,
        kept: stored.kept,
        added: stored.added,
        updated: stored.updated,
        error: stored.error ?? null,
      }),
    );
  }
  console.log(`Saved ${data.totalStored} papers to ${output}; status=${data.status}`);
  if (allFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

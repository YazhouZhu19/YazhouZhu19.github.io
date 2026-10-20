import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as classifier from "../lib/classify";
import {
  argument,
  parseEvalCsv,
  type EvalEvidence,
  type EvalRow,
  type ScopeLabel,
} from "./export-eval-sample";

const SCOPES: ScopeLabel[] = ["core", "adjacent", "out"];
const versionedClassifier = classifier as typeof classifier & {
  scopeOf?: (title: string, abstract: string) => { scope: ScopeLabel };
  SCOPE_CLASSIFIER_VERSION?: string;
};
export type Metric = {
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export function binaryMetrics(truth: boolean[], prediction: boolean[]): Metric {
  if (truth.length !== prediction.length) throw new Error("Mismatched evaluation lengths.");
  let tp = 0,
    fp = 0,
    fn = 0;
  truth.forEach((actual, index) => {
    if (actual && prediction[index]) tp++;
    else if (!actual && prediction[index]) fp++;
    else if (actual) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return {
    tp,
    fp,
    fn,
    support: tp + fn,
    precision,
    recall,
    f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : null,
  };
}

export function predictPaper(paper: EvalEvidence) {
  return {
    scope:
      versionedClassifier.scopeOf?.(paper.title, paper.abstract).scope ??
      (classifier.relevant(paper.title, paper.abstract) ? "core" : "out"),
    tracks: classifier.classify(paper.title, paper.abstract).tracks,
  };
}

export function evaluateLabels(rows: EvalRow[], evidence: EvalEvidence[], predict = predictPaper) {
  const papers = new Map(evidence.map((paper) => [paper.id, paper]));
  const evaluated = rows.filter((row) => row.label_scope);
  for (const row of rows) {
    if (!papers.has(row.id)) throw new Error(`Missing frozen evaluation evidence for ${row.id}.`);
    if (row.label_scope && !SCOPES.includes(row.label_scope as ScopeLabel))
      throw new Error(`Invalid scope label for ${row.id}.`);
    if (
      row.label_tracks
        .split(";")
        .filter(Boolean)
        .some((track) => !(track in classifier.TRACKS))
    )
      throw new Error(`Unknown track label for ${row.id}.`);
    if (row.label_scope && !row.notes.trim()) throw new Error(`Missing annotation reasoning for ${row.id}.`);
  }
  const predictions = evaluated.map((row) => {
    const paper = papers.get(row.id)!;
    return predict(paper);
  });
  const confusion = SCOPES.map((actual) =>
    SCOPES.map(
      (predicted) =>
        evaluated.filter((row, index) => row.label_scope === actual && predictions[index].scope === predicted)
          .length,
    ),
  );
  const scope = Object.fromEntries(
    SCOPES.map((label) => [
      label,
      binaryMetrics(
        evaluated.map((row) => row.label_scope === label),
        predictions.map((row) => row.scope === label),
      ),
    ]),
  );
  const tracks = Object.fromEntries(
    Object.keys(classifier.TRACKS).map((track) => [
      track,
      binaryMetrics(
        evaluated.map((row) => row.label_tracks.split(";").includes(track)),
        predictions.map((row) => row.tracks.includes(track)),
      ),
    ]),
  );
  return {
    evaluated: evaluated.length,
    unlabelled: rows.length - evaluated.length,
    confusion,
    scope,
    tracks,
    disagreements: evaluated.flatMap((row, index) =>
      row.label_scope === predictions[index].scope
        ? []
        : [{ id: row.id, expected: row.label_scope, predicted: predictions[index].scope }],
    ),
  };
}

export function annotationStatus(file: string, comments: string[]) {
  return /(?:^|\/)relevance-gold\.csv$/.test(file.replaceAll("\\", "/")) &&
    comments.some((line) => /^#\s*maintainer-reviewed:\s*\S.+$/i.test(line)) &&
    !comments.some((line) => /provisional|pending maintainer review/i.test(line))
    ? "maintainer-reviewed"
    : "provisional";
}

async function main() {
  const gold = "eval/relevance-gold.csv";
  const hasGold = await access(gold)
    .then(() => true)
    .catch(() => false);
  const file = resolve(argument("--labels", hasGold ? gold : "eval/relevance-sample.csv"));
  const evidenceFile = resolve(argument("--evidence", "eval/relevance-evidence.json"));
  const output = resolve(argument("--output", "eval/report.md"));
  const { rows, comments } = parseEvalCsv(await readFile(file, "utf8"));
  const evidence = JSON.parse(await readFile(evidenceFile, "utf8")) as {
    seed: string;
    population: number;
    snapshotCollectedAt: string;
    evidenceSha256: string;
    papers: EvalEvidence[];
  };
  if (createHash("sha256").update(JSON.stringify(evidence.papers)).digest("hex") !== evidence.evidenceSha256)
    throw new Error("Frozen evidence SHA-256 mismatch.");
  if (
    rows.length !== evidence.papers.length ||
    new Set(rows.map((row) => row.id)).size !== evidence.papers.length
  )
    throw new Error("Labels and frozen evidence must cover the same papers.");
  const status = annotationStatus(file, comments);
  if (process.argv.includes("--require-gold") && status !== "maintainer-reviewed")
    throw new Error(
      "Maintainer-reviewed gold labels are required; provisional labels cannot satisfy this gate.",
    );
  const result = evaluateLabels(rows, evidence.papers);
  if (status === "maintainer-reviewed" && result.unlabelled) throw new Error("Gold labels must be complete.");
  const pct = (value: number | null) => (value === null ? "—" : `${(100 * value).toFixed(1)}%`);
  const metricTable = (values: Record<string, Metric>) =>
    [
      "| Label | Support | TP | FP | FN | Precision | Recall | F1 |",
      "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...Object.entries(values).map(
        ([label, metric]) =>
          `| ${label} | ${metric.support} | ${metric.tp} | ${metric.fp} | ${metric.fn} | ${pct(metric.precision)} | ${pct(metric.recall)} | ${pct(metric.f1)} |`,
      ),
    ].join("\n");
  const scopeVersion =
    versionedClassifier.SCOPE_CLASSIFIER_VERSION ??
    "legacy-relevance-as-core (operational baseline, no scope classifier)";
  const report = [
    "# Relevance classifier evaluation",
    "",
    status === "provisional"
      ? "> **PROVISIONAL — pending maintainer review.** These are model-assisted draft annotations, not a human gold standard. Metrics are diagnostic only and must not be used to claim P4 acceptance targets."
      : `> Annotation status: maintainer-reviewed. ${comments.find((line) => /maintainer-reviewed:/i.test(line))?.replace(/^#\s*/, "")}`,
    "",
    `- Population: ${evidence.population}; fixed sample: ${rows.length}; labelled: ${result.evaluated}; unlabelled/excluded: ${result.unlabelled}.`,
    `- Snapshot collected at: ${evidence.snapshotCollectedAt}; seed: \`${evidence.seed}\`.`,
    `- Frozen evidence SHA-256: \`${evidence.evidenceSha256}\`.`,
    `- Scope classifier: \`${scopeVersion}\`.`,
    `- Track classifier taxonomy: \`${classifier.INTEREST_TAXONOMY_VERSION}\`.`,
    "- Sampling is balanced across source × assigned track × month, not prevalence-proportional. These unweighted metrics describe the audit sample, not population-wide accuracy.",
    "- Before scopeOf exists, relevant=true is mapped to core and relevant=false to out to measure the existing inclusive display policy. This is not an existing three-class algorithm; adjacent can never be predicted by this baseline.",
    "- Labels may select no tracks. A single word such as diagnosis or radiotherapy is insufficient evidence of a corresponding computational imaging task. Undefined precision/recall is shown as —, not a perfect score.",
    "",
    "## Scope confusion matrix",
    "",
    "Rows: annotation; columns: prediction.",
    "",
    "| Actual / predicted | core | adjacent | out |",
    "|---|---:|---:|---:|",
    ...SCOPES.map((label, index) => `| ${label} | ${result.confusion[index].join(" | ")} |`),
    "",
    "## Scope metrics",
    "",
    metricTable(result.scope),
    "",
    "## Track metrics",
    "",
    metricTable(result.tracks),
    "",
    "## Review boundaries",
    "",
    "The CSV contains only the first 600 Unicode characters of each abstract. The paired frozen evidence file contains the complete title and abstract for reproduction and review. Missing abstracts and uncertain boundaries are noted in the draft labels. Maintainers must review scope, every track, and the reason against that evidence before promoting the CSV to gold.",
    "",
    "## Scope disagreements",
    "",
    ...result.disagreements.map(
      (row) => `- \`${row.id}\`: annotation **${row.expected}**, prediction **${row.predicted}**.`,
    ),
    result.disagreements.length ? "" : "None among the labelled rows.",
    "",
  ].join("\n");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, report);
  console.log(
    `${status.toUpperCase()}: ${result.evaluated}/${rows.length} labelled; report written to ${output}.`,
  );
  if (!result.evaluated) console.log("No metrics can be interpreted until draft labels are supplied.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

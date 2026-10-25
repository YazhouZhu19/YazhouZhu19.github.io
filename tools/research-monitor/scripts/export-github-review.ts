import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  githubQuality,
  githubQualitySummary,
  matureGitHubRecords,
  GITHUB_QUALITY_VERSION,
} from "../lib/github-quality";
import { getSignalBrowseCategoryIds } from "../lib/signal-browse-categories";
import { parseResearchSignalsData, type GitHubSignal } from "../lib/research-signals";
import { buildGitHubDashboard } from "../lib/github-dashboard";
import { SIGNAL_RELEVANCE_VERSION } from "../lib/signal-relevance";
export const GITHUB_REVIEW_SEED = "oevryn-github-direct-review-2026-10-21-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function sampleDirectRepositories(records: readonly GitHubSignal[], asOf: string, size = 200) {
  const direct = records.filter((record) => record.relevance?.level === "direct");
  if (new Set(direct.map((record) => record.id)).size !== direct.length)
    throw Error("Duplicate repository IDs");
  if (!Number.isInteger(size) || size < 1 || size > direct.length) throw Error("Invalid review sample size");
  const strata = new Map<string, GitHubSignal[]>();
  for (const record of direct) {
    const categories = getSignalBrowseCategoryIds(record).sort();
    const category =
      categories[
        parseInt(hash(`${GITHUB_REVIEW_SEED}:category:${record.id}`).slice(0, 8), 16) % categories.length
      ] ?? "general";
    const stars = record.stars === 0 ? "0" : record.stars < 10 ? "1-9" : record.stars < 50 ? "10-49" : "50+";
    const stratum = `${githubQuality(record, asOf).maturity}/${stars}/${category}`;
    const rows = strata.get(stratum) ?? [];
    rows.push(record);
    strata.set(stratum, rows);
  }
  for (const rows of strata.values())
    rows.sort((a, b) =>
      hash(`${GITHUB_REVIEW_SEED}:${a.id}`).localeCompare(hash(`${GITHUB_REVIEW_SEED}:${b.id}`)),
    );
  const keys = [...strata.keys()].sort((a, b) =>
    hash(`${GITHUB_REVIEW_SEED}:stratum:${a}`).localeCompare(hash(`${GITHUB_REVIEW_SEED}:stratum:${b}`)),
  );
  const chosen: { record: GitHubSignal; stratum: string }[] = [];
  for (let round = 0; chosen.length < size; round++)
    for (const key of keys) {
      const record = strata.get(key)![round];
      if (record) chosen.push({ record, stratum: key });
      if (chosen.length === size) break;
    }
  return chosen;
}
export async function exportGitHubReview(
  input = "data/research-signals.json",
  output = "eval/github-direct-review-evidence.json",
) {
  const text = await readFile(resolve(input), "utf8"),
    data = parseResearchSignalsData(JSON.parse(text));
  const records = data.records.filter((record): record is GitHubSignal => record.kind === "github");
  const sample = sampleDirectRepositories(records, data.generatedAt);
  const before = buildGitHubDashboard(data.records, {}, data.generatedAt, data.generatedAt);
  const after = buildGitHubDashboard(
    data.records,
    { baseRecords: matureGitHubRecords(data.records, data.generatedAt) },
    data.generatedAt,
    data.generatedAt,
  );
  const evidence = {
    status: "provisional; pending human review; no direct-rule changes",
    seed: GITHUB_REVIEW_SEED,
    snapshot: data.generatedAt,
    sourceSha256: hash(text),
    qualityVersion: GITHUB_QUALITY_VERSION,
    relevanceVersion: SIGNAL_RELEVANCE_VERSION,
    population: records.length,
    directPopulation: records.filter((r) => r.relevance?.level === "direct").length,
    maturity: githubQualitySummary(records, data.generatedAt),
    default30DayScope: { before: before.rows.length, after: after.rows.length },
    sample,
  };
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await exportGitHubReview(process.argv[2], process.argv[3]);
  console.log(
    JSON.stringify({
      population: result.population,
      direct: result.directPopulation,
      sample: result.sample.length,
      maturity: result.maturity,
      scope: result.default30DayScope,
    }),
  );
}

export function githubReviewCsv(
  evidence: Awaited<ReturnType<typeof exportGitHubReview>>,
  annotations: Record<string, { label: "yes" | "no" | "uncertain"; rationale: string }> = {},
) {
  const columns = [
    "id",
    "repository",
    "url",
    "stratum",
    "maturity",
    "stars",
    "forks",
    "summary",
    "readme_excerpt",
    "provisional_label",
    "provisional_rationale",
    "human_label",
    "human_notes",
  ];
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return `"${(/^[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  };
  const rows = evidence.sample.map(({ record, stratum }) => [
    record.id,
    record.fullName,
    record.url,
    stratum,
    githubQuality(record, evidence.snapshot).maturity,
    record.stars,
    record.forks,
    record.summary,
    record.readmeExcerpt,
    annotations[record.id]?.label ?? "",
    annotations[record.id]?.rationale ?? "",
    "",
    "",
  ]);
  return `# PROVISIONAL: Codex metadata review; pending human confirmation; direct rules unchanged\n# snapshot=${evidence.snapshot}; seed=${evidence.seed}; source_sha256=${evidence.sourceSha256}\n${columns.join(",")}\n${rows.map((row) => row.map(escape).join(",")).join("\n")}\n`;
}

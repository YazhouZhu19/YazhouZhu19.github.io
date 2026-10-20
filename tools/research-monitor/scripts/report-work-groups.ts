import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { groupWorks, normalizedWorkTitle, titleAuthorMatch, WORK_GROUPING_VERSION } from "../lib/paper-works";
import type { Paper } from "../lib/types";
import { readSnapshotFile } from "./snapshot-files";

const seed = "oevryn-work-groups-2026-10-21-v1";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const esc = (value: string) => value.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");

export function inspectWorkGroups(papers: Paper[], collectedAt: string) {
  const baseline = groupWorks(papers, { titleAuthors: false });
  const baselineId = new Map(baseline.flatMap((group, index) => group.map((p) => [p.id, index] as const)));
  const grouped = groupWorks(papers);
  const duplicateGroups = grouped
    .filter((group) => group.length > 1)
    .map((group) => {
      const records = [...group].sort((a, b) => a.id.localeCompare(b.id));
      const id = digest(records.map((paper) => paper.id).join("\n")).slice(0, 16);
      const matches = records.flatMap((a, index) =>
        records.slice(index + 1).flatMap((b) => {
          const match = titleAuthorMatch(a, b);
          return match ? [{ recordIds: [a.id, b.id], ...match }] : [];
        }),
      );
      return {
        id,
        addedByTitleAuthors: new Set(records.map((p) => baselineId.get(p.id))).size > 1,
        mixedPreprintPublished:
          records.some((p) => p.status === "preprint") && records.some((p) => p.status === "published"),
        records: records.map((paper) => ({
          id: paper.id,
          title: paper.title,
          authors: paper.authors.map((a) => a.name),
          source: paper.source,
          status: paper.status,
          publishedAt: paper.publishedAt,
          doi: paper.doi,
          relatedDoi: paper.relatedDoi ?? null,
          url: paper.url,
        })),
        matches,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const titles = new Map<string, number>();
  papers.forEach((p) => {
    const title = normalizedWorkTitle(p.title);
    if (title) titles.set(title, (titles.get(title) ?? 0) + 1);
  });
  const newGroups = duplicateGroups.filter((group) => group.addedByTitleAuthors);
  const priority = (a: { id: string }, b: { id: string }) =>
    digest(seed + a.id).localeCompare(digest(seed + b.id));
  const mixed = newGroups
    .filter((g) => g.mixedPreprintPublished)
    .sort(priority)
    .slice(0, 10);
  const selectedIds = new Set(mixed.map((g) => g.id));
  const rest = newGroups
    .filter((g) => !selectedIds.has(g.id))
    .sort(priority)
    .slice(0, 20 - mixed.length);
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  return {
    version: WORK_GROUPING_VERSION,
    snapshotCollectedAt: collectedAt,
    recordCount: papers.length,
    baselineWorkCount: baseline.length,
    workCount: grouped.length,
    duplicateGroupCount: duplicateGroups.length,
    newTitleAuthorGroupCount: newGroups.length,
    exactNormalizedTitleBuckets: [...titles.values()].filter((n) => n > 1).length,
    mixedPreprintPublishedGroups: duplicateGroups.filter((g) => g.mixedPreprintPublished).length,
    duplicateGroups,
    sample: {
      seed,
      humanReviewed: false,
      status: "provisional-ai-review-pending",
      groups: [...mixed, ...rest].map((group) => ({
        ...group,
        humanConfirmed: false,
        aiReviewed: false,
        aiFinding: "",
        aiReason: "",
        evidence: group.records.map((record) => ({
          id: record.id,
          abstract: paperById.get(record.id)?.abstract ?? "",
        })),
      })),
    },
  };
}

export function renderWorkGroups(report: ReturnType<typeof inspectWorkGroups>) {
  return (
    `# Possible work groups\n\n` +
    `Snapshot: ${report.snapshotCollectedAt}. Rule: \`${report.version}\`.\n\n` +
    `${report.recordCount} records → ${report.workCount} possible works; identity-only baseline: ${report.baselineWorkCount}. ` +
    `${report.duplicateGroupCount} multi-record groups, including ${report.newTitleAuthorGroupCount} connected by the new title/author rule and ${report.mixedPreprintPublishedGroups} preprint/published groups. ` +
    `There are ${report.exactNormalizedTitleBuckets} repeated normalized-title buckets; author evidence is required, so title equality alone is not a merge.\n\n` +
    `Records, identifiers, source metadata and snapshots are unchanged. These are possible version groups, not verified equivalence. ` +
    `The reproducible 20-group review sample is in [work-groups-review.json](work-groups-review.json); its review is provisional AI review, not the plan's human acceptance check.\n\n` +
    `| Group | Rule | Records | Titles |\n| --- | --- | --- | --- |\n` +
    report.duplicateGroups
      .map(
        (group) =>
          `| ${group.id} | ${group.addedByTitleAuthors ? "title + authors" : "identifier"} | ${group.records.map((p) => `[${esc(p.id)}](${p.url})`).join("<br>")} | ${group.records.map((p) => esc(p.title)).join("<br>")} |`,
      )
      .join("\n") +
    "\n"
  );
}

async function main() {
  const input = resolve(process.argv[2] ?? "data/papers.json");
  const output = resolve(process.argv[3] ?? "eval/work-groups");
  const snapshot = await readSnapshotFile(input);
  const report = inspectWorkGroups(snapshot.papers, snapshot.collectedAt);
  await mkdir(dirname(output), { recursive: true });
  const { sample, ...summary } = report;
  await writeFile(output + ".json", JSON.stringify(summary, null, 2) + "\n");
  await writeFile(output + ".md", renderWorkGroups(report).trimEnd() + "\n");
  // Review outputs are separate so reruns never pretend machine candidates were manually confirmed.
  await writeFile(output + "-review-candidates.json", JSON.stringify(sample, null, 2) + "\n");
  console.log(
    JSON.stringify({
      records: report.recordCount,
      baselineWorks: report.baselineWorkCount,
      works: report.workCount,
      duplicateGroups: report.duplicateGroupCount,
      newGroups: report.newTitleAuthorGroupCount,
      mixedVersionGroups: report.mixedPreprintPublishedGroups,
      reviewCandidates: sample.groups.length,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

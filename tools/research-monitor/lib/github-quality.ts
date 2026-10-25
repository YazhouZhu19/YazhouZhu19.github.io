import type { GitHubSignal, ResearchSignal } from "./research-signals";

/** Metadata maturity is an exploration aid, never a scientific quality grade. */
export const GITHUB_QUALITY_VERSION = "2026-10-21-v1";
export type GitHubMaturity = "established" | "active" | "early";
export type GitHubQuality = { maturity: GitHubMaturity; reasons: string[] };
const DAY = 86_400_000;
function validTime(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const day = value.slice(0, 10),
    time = Date.parse(value),
    midnight = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) &&
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === day
    ? time
    : null;
}
export function hasPaperLink(urls: readonly string[]): boolean {
  return urls.some((value) => {
    try {
      const url = new URL(value),
        path = decodeURIComponent(url.pathname);
      return (
        url.protocol === "https:" &&
        ((["doi.org", "dx.doi.org"].includes(url.hostname) && /^\/10\.\d{4,9}\/\S+/i.test(path)) ||
          (["arxiv.org", "export.arxiv.org"].includes(url.hostname) &&
            /^\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?(?:\.pdf)?\/?$/i.test(path)))
      );
    } catch {
      return false;
    }
  });
}
export function githubQuality(record: GitHubSignal, asOf: string): GitHubQuality {
  const reasons: string[] = [];
  if (record.stars >= 50) reasons.push("stars-at-least-50");
  if (record.forks >= 10) reasons.push("forks-at-least-10");
  if (record.stars >= 10 && hasPaperLink(record.relatedUrls))
    reasons.push("paper-link-and-stars-at-least-10");
  if (reasons.length)
    return {
      maturity: record.archived ? "active" : "established",
      reasons: [...reasons, ...(record.archived ? ["archived-cap"] : [])],
    };
  const reference = validTime(asOf),
    push = validTime(record.pushedAt);
  const recent = reference !== null && push !== null && push <= reference && push >= reference - 180 * DAY;
  if (recent) {
    if (
      record.license?.trim() &&
      !/^(?:noassertion|none|unknown|unlicensed|n\/a)$/i.test(record.license.trim())
    )
      reasons.push("identified-license");
    if ([...record.readmeExcerpt.replace(/\s+/g, " ").trim()].length >= 200)
      reasons.push("readme-at-least-200");
    if (record.stars >= 5) reasons.push("stars-at-least-5");
    if (reasons.length) return { maturity: "active", reasons: ["push-within-180-days", ...reasons] };
  }
  return {
    maturity: "early",
    reasons: [reference === null ? "snapshot-date-unavailable" : "limited-maturity-metadata"],
  };
}
export function githubQualitySummary(records: readonly ResearchSignal[], asOf: string) {
  const counts: Record<GitHubMaturity, number> = { established: 0, active: 0, early: 0 };
  const seen = new Set<string>();
  for (const record of records)
    if (record.kind === "github" && !seen.has(record.id)) {
      seen.add(record.id);
      counts[githubQuality(record, asOf).maturity]++;
    }
  return { version: GITHUB_QUALITY_VERSION, asOf, counts, defaultCount: counts.established + counts.active };
}
export function matureGitHubRecords(records: readonly ResearchSignal[], asOf: string): GitHubSignal[] {
  return records.filter(
    (record): record is GitHubSignal =>
      record.kind === "github" && githubQuality(record, asOf).maturity !== "early",
  );
}

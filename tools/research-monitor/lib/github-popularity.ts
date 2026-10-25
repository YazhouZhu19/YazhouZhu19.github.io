import type { GitHubSignal } from "./research-signals";

export type GitHubPopularityMetric = "stars" | "forks";
export interface GitHubPopularityRank {
  record: GitHubSignal;
  rank: number;
  value: number;
}
export interface GitHubPopularityStats {
  total: number;
  median: number | null;
  count: number;
  recordIds: string[];
  ranked: GitHubPopularityRank[];
  hasVariation: boolean;
}
export interface GitHubPopularity {
  stars: GitHubPopularityStats;
  forks: GitHubPopularityStats;
  observedFrom: string | null;
  observedTo: string | null;
  observedCount: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Shared by the dashboard ranking and project list; independent of UI locale. */
export function compareGitHubPopularity(
  a: GitHubSignal,
  b: GitHubSignal,
  metric: GitHubPopularityMetric,
): number {
  return (
    b[metric] - a[metric] ||
    compareText(a.fullName.toLowerCase(), b.fullName.toLowerCase()) ||
    compareText(a.fullName, b.fullName) ||
    compareText(a.id, b.id)
  );
}

function summarize(rows: readonly GitHubSignal[], metric: GitHubPopularityMetric): GitHubPopularityStats {
  const sorted = [...rows].sort((a, b) => compareGitHubPopularity(a, b, metric));
  let rank = 0;
  const ranked = sorted.map((record, index) => {
    if (index === 0 || record[metric] !== sorted[index - 1][metric]) rank = index + 1;
    return { record, rank, value: record[metric] };
  });
  const count = rows.length,
    middle = Math.floor(count / 2);
  return {
    total: rows.reduce((total, record) => total + record[metric], 0),
    median:
      count === 0
        ? null
        : count % 2
          ? sorted[middle][metric]
          : (sorted[middle - 1][metric] + sorted[middle][metric]) / 2,
    count,
    recordIds: rows.map((record) => record.id),
    ranked,
    hasVariation: count > 1 && sorted[0][metric] !== sorted[count - 1][metric],
  };
}

/**
 * Input is the dashboard's deduplicated, fully filtered population. Counts are
 * the latest stored cumulative repository snapshots, not growth during the
 * selected creation/activity period. Observation times can differ by record.
 */
export function buildGitHubPopularity(rows: readonly GitHubSignal[]): GitHubPopularity {
  const times = rows
    .map((record) => Date.parse(record.observedAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    stars: summarize(rows, "stars"),
    forks: summarize(rows, "forks"),
    observedFrom: times.length ? new Date(times[0]).toISOString() : null,
    observedTo: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    observedCount: times.length,
  };
}

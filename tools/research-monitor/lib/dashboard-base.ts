import { publicationDateStatus } from "./publication-date";
import type { MonitorData, Paper, SyncRun } from "./types";

export function dashboardSourceFacts(data: MonitorData) {
  return ["Europe PMC", "arXiv", "medRxiv"].map((name) => {
    let last: SyncRun | undefined, success: SyncRun | undefined;
    for (const run of data.runs) {
      if (run.source !== name) continue;
      if (!last || run.completedAt.localeCompare(last.completedAt) > 0) last = run;
      if (
        run.status !== "error" &&
        !run.error &&
        (!success || run.completedAt.localeCompare(success.completedAt) > 0)
      )
        success = run;
    }
    return { name, last, success, count: data.papers.filter((paper) => paper.sources.includes(name)).length };
  });
}

const beijingFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function beijingDay(value: string | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? beijingFormatter.format(date) : "";
}

type PaperDates = {
  publication: string;
  discovery: string;
  status: ReturnType<typeof publicationDateStatus>;
  initial: boolean;
};

export type DashboardBase = {
  papers: Paper[];
  runs: MonitorData["runs"];
  collectedAt: string;
  initialCollectedAt: MonitorData["initialCollectedAt"];
  day: string;
  initialTime: number;
  dates: ReadonlyMap<Paper, PaperDates>;
  newToday: Paper[];
  sourceFacts: ReturnType<typeof dashboardSourceFacts>;
};

/** Reuse only for an immutable snapshot on the same Beijing day. */
export function createDashboardBase(data: MonitorData, day: string): DashboardBase {
  const firstSeen = new Map(data.papers.map((paper) => [paper, Date.parse(paper.firstSeenAt)]));
  const validFirstSeen = [...firstSeen.values()].filter(Number.isFinite);
  const initialTime =
    typeof data.initialCollectedAt === "string" && Number.isFinite(Date.parse(data.initialCollectedAt))
      ? Date.parse(data.initialCollectedAt)
      : validFirstSeen.length
        ? Math.min(...validFirstSeen)
        : Date.parse(data.collectedAt);
  const dates = new Map<Paper, PaperDates>();
  const newToday: Paper[] = [];
  for (const paper of data.papers) {
    const entry = {
      publication: paper.publishedAt.slice(0, 10),
      discovery: beijingDay(paper.firstSeenAt),
      status: publicationDateStatus(paper, day),
      initial: firstSeen.get(paper) === initialTime,
    };
    dates.set(paper, entry);
    if (entry.status === "valid" && !entry.initial && entry.discovery === day) newToday.push(paper);
  }
  return {
    papers: data.papers,
    runs: data.runs,
    collectedAt: data.collectedAt,
    initialCollectedAt: data.initialCollectedAt,
    day,
    initialTime,
    dates,
    newToday,
    sourceFacts: dashboardSourceFacts(data),
  };
}

export function dashboardBaseMatches(base: DashboardBase, data: MonitorData, day: string): boolean {
  return (
    base.papers === data.papers &&
    base.runs === data.runs &&
    base.collectedAt === data.collectedAt &&
    base.initialCollectedAt === data.initialCollectedAt &&
    base.day === day
  );
}

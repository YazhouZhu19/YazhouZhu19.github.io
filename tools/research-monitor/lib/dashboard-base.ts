import { publicationDateStatus } from "./publication-date";
import type { MonitorData, Paper, SyncRun } from "./types";

export type DashboardPaper = Pick<
  Paper,
  | "id"
  | "title"
  | "url"
  | "authors"
  | "doi"
  | "relatedDoi"
  | "pmid"
  | "arxivId"
  | "source"
  | "sources"
  | "status"
  | "publishedAt"
  | "dateAnomaly"
  | "firstSeenAt"
  | "tracks"
  | "tasks"
  | "modalities"
  | "methods"
> & { provenance: { sourceRecordId?: string }[]; scope?: Paper["scope"] };
export type DashboardData<P extends DashboardPaper = Paper> = Pick<
  MonitorData,
  | "runs"
  | "collectedAt"
  | "storageAvailable"
  | "lastSuccessfulSync"
  | "coverage"
  | "status"
  | "errors"
  | "error"
  | "personalStorageAvailable"
  | "personalStorageReadable"
  | "personalStorageError"
> & { papers: P[]; totalStored?: number; initialCollectedAt?: unknown; [key: string]: unknown };

export function dashboardSourceFacts<P extends DashboardPaper>(data: DashboardData<P>) {
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

export type DashboardBase<P extends DashboardPaper = Paper> = {
  papers: P[];
  runs: MonitorData["runs"];
  collectedAt: string;
  initialCollectedAt: MonitorData["initialCollectedAt"];
  day: string;
  initialTime: number;
  dates: ReadonlyMap<P, PaperDates>;
  newToday: P[];
  sourceFacts: ReturnType<typeof dashboardSourceFacts>;
};

/** Reuse only for an immutable snapshot on the same Beijing day. */
export function createDashboardBase<P extends DashboardPaper>(
  data: DashboardData<P>,
  day: string,
): DashboardBase<P> {
  const firstSeen = new Map(data.papers.map((paper) => [paper, Date.parse(paper.firstSeenAt)]));
  const validFirstSeen = [...firstSeen.values()].filter(Number.isFinite);
  const initialTime =
    typeof data.initialCollectedAt === "string" && Number.isFinite(Date.parse(data.initialCollectedAt))
      ? Date.parse(data.initialCollectedAt)
      : validFirstSeen.length
        ? Math.min(...validFirstSeen)
        : Date.parse(data.collectedAt);
  const dates = new Map<P, PaperDates>();
  const newToday: P[] = [];
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

export function dashboardBaseMatches<P extends DashboardPaper>(
  base: DashboardBase<P>,
  data: DashboardData<P>,
  day: string,
): boolean {
  return (
    base.papers === data.papers &&
    base.runs === data.runs &&
    base.collectedAt === data.collectedAt &&
    base.initialCollectedAt === data.initialCollectedAt &&
    base.day === day
  );
}

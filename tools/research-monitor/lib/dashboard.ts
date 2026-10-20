import { TASKS, TRACKS, normalizedName } from "./classify";
import type { Author, MonitorData, Paper, Team } from "./types";
import { compareCategoryWindows } from "./trend-statistics";
import {
  beijingDay,
  createDashboardBase,
  dashboardBaseMatches,
  dashboardSourceFacts,
  type DashboardBase,
} from "./dashboard-base";
export { beijingDay } from "./dashboard-base";

export type DashboardFilters = {
  days: string;
  clock: "publication" | "discovery";
  track: string;
  source: string;
};
export type DashboardDrill = { label: string; ids: string[] };
export const defaultDashboardFilters: DashboardFilters = {
  days: "30",
  clock: "publication",
  track: "all",
  source: "all",
};
const dayMs = 86400000;
export function matchesMember(author: Author, members: string[]) {
  const identity = (v: string) => normalizedName(v.trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, ""));
  return members.some((m) =>
    [author.name, author.displayName ?? "", author.orcid ?? ""].some((v) => v && identity(v) === identity(m)),
  );
}
export function matchesTeam(p: Paper, t: Team) {
  return p.authors.some(
    (a) =>
      matchesMember(a, t.members) &&
      (!t.institution || a.affiliations.some((v) => v.toLowerCase().includes(t.institution.toLowerCase()))),
  );
}
/** Source age changes within a day; callers can refresh this without rebuilding every chart. */
export function buildSourceHealth(data: MonitorData, now = new Date(), cachedBase?: DashboardBase) {
  const facts =
    cachedBase && dashboardBaseMatches(cachedBase, data, beijingDay(now))
      ? cachedBase.sourceFacts
      : dashboardSourceFacts(data);
  return facts.map(({ name, last, success, count }) => {
    const updatedAt = success?.completedAt ?? null;
    const stale = !!updatedAt && now.getTime() - Date.parse(updatedAt) > dayMs;
    const failed = last?.status === "error" || !!last?.error;
    const state =
      last?.status === "error"
        ? "同步失败"
        : last?.error
          ? "部分失败"
          : !data.storageAvailable
            ? "快照模式"
            : stale
              ? "超过 24 小时"
              : !last
                ? "尚无增量同步"
                : last.status === "partial"
                  ? "有限覆盖"
                  : "窗口采集完成";
    return {
      name,
      state,
      updatedAt,
      warning: !data.storageAvailable || stale || failed,
      limited: last?.status === "partial" && !failed,
      initial: !success,
      count,
    };
  });
}
export function buildDashboard(
  data: MonitorData,
  teams: Team[],
  filters: DashboardFilters,
  now = new Date(),
  cachedBase?: DashboardBase,
) {
  const today = beijingDay(now);
  const start =
    filters.days === "all"
      ? ""
      : new Date(Date.parse(today) - (Number(filters.days) - 1) * dayMs).toISOString().slice(0, 10);
  // The UI supplies a snapshot/day memo; direct callers still get fresh calculations.
  const base =
    cachedBase && dashboardBaseMatches(cachedBase, data, today)
      ? cachedBase
      : createDashboardBase(data, today);
  const { initialTime, newToday } = base;
  const isInitial = (paper: Paper) => base.dates.get(paper)!.initial;
  const statusOf = (paper: Paper) => base.dates.get(paper)!.status;
  const dateOf = (paper: Paper) => base.dates.get(paper)![filters.clock];
  const sourcePool = data.papers.filter(
    (p) => filters.source === "all" || p.sources.includes(filters.source),
  );
  const pool = sourcePool.filter((p) => filters.track === "all" || p.tracks.includes(filters.track));
  const datedSourcePool = sourcePool.filter((p) => {
    if (statusOf(p) !== "valid") return false;
    const date = dateOf(p);
    return date && date <= today && (filters.clock !== "discovery" || !isInitial(p));
  });
  const denominatorRows = datedSourcePool.filter((p) => !start || dateOf(p) >= start);
  const rows = denominatorRows.filter((p) => filters.track === "all" || p.tracks.includes(filters.track));
  const directionComparison = start
    ? compareCategoryWindows(
        datedSourcePool.map((p) => ({
          id: p.id,
          day: dateOf(p),
          categories: filters.track === "all" || p.tracks.includes(filters.track) ? p.tracks : [],
        })),
        start,
        today,
        Object.keys(TRACKS),
      )
    : null;
  const initialCount = pool.filter(isInitial).length;
  const directions = Object.entries(TRACKS).map(([id, label]) => ({
    id,
    label,
    papers: rows.filter((p) => p.tracks.includes(id)),
  }));
  const published = rows.filter((p) => p.status === "published");
  const preprints = rows.filter((p) => p.status === "preprint");
  const teamRows = teams
    .map((team) => ({ team, papers: rows.filter((p) => matchesTeam(p, team)) }))
    .sort((a, b) => b.papers.length - a.papers.length);
  const teamIds = new Set(teamRows.flatMap((r) => r.papers.map((p) => p.id)));
  const matched = rows.filter((p) => teamIds.has(p.id));
  const status = [
    { key: "preprint", label: "预印本", color: "#bc7b60" },
    { key: "published", label: "正式发表", color: "#42765b" },
    { key: "unknown", label: "状态未确认", color: "#8c9685" },
  ].map((s) => ({ ...s, count: rows.filter((p) => p.status === s.key).length }));
  const known = status[0].count + status[1].count;
  const preprintRate = known ? (status[0].count / known) * 100 : null;
  const earliest = rows.reduce((min, p) => (dateOf(p) < min ? dateOf(p) : min), today);
  const from = start || earliest;
  const initialDay = beijingDay(new Date(initialTime));
  const observedFrom = filters.clock === "discovery" && initialDay > from ? initialDay : from;
  const monthly = (Date.parse(today) - Date.parse(observedFrom)) / dayMs > 90;
  const buckets = new Map<
    string,
    { date: string; all: number; published: number; preprint: number; ids: string[] }
  >();
  const cursor = new Date(monthly ? observedFrom.slice(0, 7) + "-01" : observedFrom);
  while (cursor.toISOString().slice(0, 10) <= today) {
    const key = cursor.toISOString().slice(0, monthly ? 7 : 10);
    buckets.set(key, { date: key, all: 0, published: 0, preprint: 0, ids: [] });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const p of rows) {
    const r = buckets.get(dateOf(p).slice(0, monthly ? 7 : 10));
    if (!r) continue;
    r.all++;
    r.ids.push(p.id);
    if (p.status === "published") r.published++;
    if (p.status === "preprint") r.preprint++;
  }
  const modalities = [
    "MRI",
    "CT",
    "X-ray",
    "超声",
    "PET / SPECT",
    "病理切片",
    "眼底 / OCT",
    "内镜",
    "未识别",
  ];
  const matrix = Object.entries(TASKS).map(([task, label]) => ({
    task,
    label,
    cells: modalities.map((modality) => ({ modality, papers: [] as Paper[] })),
  }));
  const matrixCells = new Map(
    matrix.map((row) => [row.task, new Map(row.cells.map((cell) => [cell.modality, cell.papers]))]),
  );
  for (const paper of rows) {
    const paperModalities = new Set(paper.modalities.length ? paper.modalities : ["未识别"]);
    for (const task of new Set(paper.tasks)) {
      const cells = matrixCells.get(task);
      if (!cells) continue;
      for (const modality of paperModalities) {
        // The unknown column means no modality tags, not an explicit unknown tag.
        if (modality === "未识别" && paper.modalities.length) continue;
        cells.get(modality)?.push(paper);
      }
    }
  }
  const methods = [...new Set(rows.flatMap((p) => p.methods))]
    .map((name) => ({ name, papers: rows.filter((p) => p.methods.includes(name)) }))
    .sort((a, b) => b.papers.length - a.papers.length);
  const sources = buildSourceHealth(data, now, base);
  return {
    rows,
    directionDenominator: denominatorRows.length,
    directionComparison,
    start: from,
    observedFrom,
    end: today,
    initialCount,
    newToday,
    directions,
    published,
    preprints,
    teamRows,
    matched,
    status,
    known,
    preprintRate,
    trend: [...buckets.values()],
    monthly,
    modalities,
    matrix,
    methods,
    sources,
    futureCount: pool.filter((p) => statusOf(p) === "future" || dateOf(p) > today).length,
    invalidDateCount: pool.filter((p) => statusOf(p) === "invalid").length,
  };
}

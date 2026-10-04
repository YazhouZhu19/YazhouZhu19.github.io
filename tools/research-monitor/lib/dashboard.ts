import { TASKS, TRACKS, normalizedName } from "./classify";
import type { Author, MonitorData, Paper, Team } from "./types";

export type DashboardFilters = { days: string; clock: "publication" | "discovery"; track: string; source: string };
export type DashboardDrill = { label: string; ids: string[] };
export const defaultDashboardFilters: DashboardFilters = { days: "30", clock: "publication", track: "all", source: "all" };
const dayMs = 86400000;
const beijingFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
export function beijingDay(value: string | Date): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return beijingFormatter.format(d);
}
export function matchesMember(author: Author, members: string[]) {
  const identity = (v: string) => normalizedName(v.replace(/^https?:\/\/orcid.org\//i, ""));
  return members.some(m => [author.name, author.displayName ?? "", author.orcid ?? ""].some(v => v && identity(v) === identity(m)));
}
export function matchesTeam(p: Paper, t: Team) {
  return p.authors.some(a => matchesMember(a, t.members) && (!t.institution || a.affiliations.some(v => v.toLowerCase().includes(t.institution.toLowerCase()))));
}
/** Source age changes within a day; callers can refresh this without rebuilding every chart. */
export function buildSourceHealth(data: MonitorData, now = new Date()) {
  return ["Europe PMC", "arXiv", "medRxiv"].map(name => {
    const sourceRuns = data.runs.filter(r => r.source === name).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const last = sourceRuns[0];
    const success = sourceRuns.find(r => r.status !== "error" && !r.error);
    const updatedAt = success?.completedAt ?? null;
    const stale = !!updatedAt && now.getTime() - Date.parse(updatedAt) > dayMs;
    const failed = last?.status === "error" || !!last?.error;
    const state = last?.status === "error" ? "同步失败" : last?.error ? "部分失败" : !data.storageAvailable ? "快照模式" : stale ? "超过 24 小时" : !last ? "尚无增量同步" : last.status === "partial" ? "有限覆盖" : "窗口采集完成";
    return { name, state, updatedAt, warning: !data.storageAvailable || stale || failed, limited: last?.status === "partial" && !failed, initial: !success, count: data.papers.filter(p => p.sources.includes(name)).length };
  });
}
export function buildDashboard(data: MonitorData, teams: Team[], filters: DashboardFilters, now = new Date()) {
  const today = beijingDay(now);
  const start = filters.days === "all" ? "" : new Date(Date.parse(today) - (Number(filters.days) - 1) * dayMs).toISOString().slice(0, 10);
  // collectedAt advances on each refresh; the initial import must remain anchored.
  const firstSeenDates = data.papers.map(p => Date.parse(p.firstSeenAt)).filter(Number.isFinite);
  const initialTime = typeof data.initialCollectedAt === "string" && Number.isFinite(Date.parse(data.initialCollectedAt))
    ? Date.parse(data.initialCollectedAt)
    : firstSeenDates.length ? Math.min(...firstSeenDates) : Date.parse(data.collectedAt);
  const isInitial = (p: Paper) => Date.parse(p.firstSeenAt) === initialTime;
  // Reuse each record's date across scope selection, buckets and exclusions in this build.
  const dates = new Map<Paper, string>();
  const dateOf = (p: Paper) => {
    let date = dates.get(p);
    if (date === undefined) {
      date = filters.clock === "discovery" ? beijingDay(p.firstSeenAt) : p.publishedAt.slice(0, 10);
      dates.set(p, date);
    }
    return date;
  };
  const pool = data.papers.filter(p => (filters.track === "all" || p.tracks.includes(filters.track)) && (filters.source === "all" || p.sources.includes(filters.source)));
  const rows = pool.filter(p => {
    const date = dateOf(p);
    return date && date <= today && (!start || date >= start) && (filters.clock !== "discovery" || !isInitial(p));
  });
  const initialCount = pool.filter(isInitial).length;
  const newToday = data.papers.filter(p => !isInitial(p) && beijingDay(p.firstSeenAt) === today);
  const directions = Object.entries(TRACKS).map(([id, label]) => ({ id, label, papers: rows.filter(p => p.tracks.includes(id)) }));
  const published = rows.filter(p => p.status === "published");
  const preprints = rows.filter(p => p.status === "preprint");
  const teamRows = teams.map(team => ({ team, papers: rows.filter(p => matchesTeam(p, team)) })).sort((a, b) => b.papers.length - a.papers.length);
  const teamIds = new Set(teamRows.flatMap(r => r.papers.map(p => p.id)));
  const matched = rows.filter(p => teamIds.has(p.id));
  const status = [
    { key: "preprint", label: "预印本", color: "#bc7b60" },
    { key: "published", label: "正式发表", color: "#42765b" },
    { key: "unknown", label: "状态未确认", color: "#8c9685" },
  ].map(s => ({ ...s, count: rows.filter(p => p.status === s.key).length }));
  const known = status[0].count + status[1].count;
  const preprintRate = known ? status[0].count / known * 100 : null;
  const earliest = rows.reduce((min, p) => dateOf(p) < min ? dateOf(p) : min, today);
  const from = start || earliest;
  const initialDay = beijingDay(new Date(initialTime));
  const observedFrom = filters.clock === "discovery" && initialDay > from ? initialDay : from;
  const monthly = (Date.parse(today) - Date.parse(observedFrom)) / dayMs > 90;
  const buckets = new Map<string, { date: string; all: number; published: number; preprint: number; ids: string[] }>();
  const cursor = new Date(monthly ? observedFrom.slice(0, 7) + "-01" : observedFrom);
  while (cursor.toISOString().slice(0, 10) <= today) {
    const key = cursor.toISOString().slice(0, monthly ? 7 : 10);
    buckets.set(key, { date: key, all: 0, published: 0, preprint: 0, ids: [] });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1); else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const p of rows) {
    const r = buckets.get(dateOf(p).slice(0, monthly ? 7 : 10));
    if (!r) continue;
    r.all++; r.ids.push(p.id);
    if (p.status === "published") r.published++;
    if (p.status === "preprint") r.preprint++;
  }
  const modalities = ["MRI", "CT", "X-ray", "超声", "PET / SPECT", "病理切片", "眼底 / OCT", "内镜", "未识别"];
  const matrix = Object.entries(TASKS).map(([task, label]) => ({ task, label, cells: modalities.map(modality => ({ modality, papers: [] as Paper[] })) }));
  const matrixCells = new Map(matrix.map(row => [row.task, new Map(row.cells.map(cell => [cell.modality, cell.papers]))]));
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
  const methods = [...new Set(rows.flatMap(p => p.methods))].map(name => ({ name, papers: rows.filter(p => p.methods.includes(name)) })).sort((a, b) => b.papers.length - a.papers.length);
  const sources = buildSourceHealth(data, now);
  return { rows, start: from, observedFrom, end: today, initialCount, newToday, directions, published, preprints, teamRows, matched, status, known, preprintRate, trend: [...buckets.values()], monthly, modalities, matrix, methods, sources, futureCount: pool.filter(p => dateOf(p) > today).length };
}

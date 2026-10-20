import type { GitHubSignal, ResearchSignal } from "./research-signals";
import { buildSignalDashboard, signalDashboardDate, type SignalDashboard, type SignalDashboardBucket } from "./signal-dashboard";
import { buildGitHubPopularity, type GitHubPopularity } from "./github-popularity";

const DAY = 86_400_000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
export type GitHubDashboardClock = "activity" | "creation";
export interface GitHubDashboardFilters {
  baseRecords?: readonly ResearchSignal[];
  range?: 7 | 30 | 90 | "all" | "custom";
  clock?: GitHubDashboardClock;
  from?: string;
  to?: string;
}
export interface GitHubDashboardSeriesRow {
  date: string;
  count: number | null;
  direct: number | null;
  candidate: number | null;
  recordIds: string[];
  directRecordIds: string[];
  candidateRecordIds: string[];
  isToday: boolean;
  observed: boolean;
}
export interface GitHubDashboardModel {
  global: { total: SignalDashboardBucket; today: SignalDashboardBucket; initial: SignalDashboardBucket };
  rows: GitHubSignal[];
  scoped: SignalDashboard;
  popularity: GitHubPopularity;
  series: GitHubDashboardSeriesRow[];
  seriesGranularity: "day" | "month";
  filters: { range: NonNullable<GitHubDashboardFilters["range"]>; clock: NonNullable<GitHubDashboardFilters["clock"]> };
  today: string | null;
  start: string | null;
  end: string | null;
  observedFrom: string | null;
  observedTo: string | null;
  initialAt: string | null;
  initialDay: string | null;
  initialInScope: SignalDashboardBucket;
  now: string | null;
  asOf: string | null;
  snapshotDay: string | null;
  snapshotStale: boolean;
  snapshotInFuture: boolean;
  referenceDateValid: boolean;
  nowValid: boolean;
  rangeValid: boolean;
  excluded: { missing: SignalDashboardBucket; future: SignalDashboardBucket; outside: SignalDashboardBucket; unavailable: SignalDashboardBucket };
}

function stamp(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const time = Date.parse(value);
  return Number.isFinite(time) && Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === day ? time : null;
}
function beijingDay(value: number): string { return new Date(value + BEIJING_OFFSET).toISOString().slice(0, 10); }
function dayTime(value: string): number { return Date.parse(`${value}T00:00:00Z`); }
function validDay(value: string | undefined): value is string { return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && stamp(value) !== null; }
function shiftDay(value: string, days: number): string { return new Date(dayTime(value) + days * DAY).toISOString().slice(0, 10); }
function nextMonth(value: string): string {
  const date = new Date(dayTime(`${value}-01`));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}
function bucket(id: string, labelZh: string, labelEn: string, recordIds: string[] = []): SignalDashboardBucket {
  return { id, labelZh, labelEn, recordIds, count: recordIds.length };
}
function add(target: SignalDashboardBucket, id: string): void { target.recordIds.push(id); target.count++; }

/** GitHub created_at is repository creation, not the time a private repo became public. */
export function githubDashboardDate(record: GitHubSignal, clock: GitHubDashboardClock): string | null {
  if (clock === "activity") return signalDashboardDate(record);
  const time = stamp(record.publishedAt);
  return time === null ? null : new Date(time).toISOString();
}

/**
 * firstSeenAt is assigned when a repository enters the collector, then retained
 * when that ID is refreshed. It is not the repository's creation date. There is
 * no stored initial-import marker: the earliest full-library timestamp is only
 * an inferred baseline, fixed independently of the UI's selected population.
 */
export function buildGitHubDashboard(allRecords: readonly ResearchSignal[], filters: GitHubDashboardFilters = {},
  now: Date | string = new Date(), asOf?: string): GitHubDashboardModel {
  const all = new Map<string, GitHubSignal>();
  for (const record of allRecords) if (record.kind === "github" && !all.has(record.id)) all.set(record.id, record);
  const allGitHub = [...all.values()];
  const selected = new Set((filters.baseRecords ?? allGitHub).filter(record => record.kind === "github").map(record => record.id));
  const base = allGitHub.filter(record => selected.has(record.id));
  const range = filters.range ?? 30, clock = filters.clock ?? "activity";
  const current = stamp(now), snapshot = stamp(asOf);
  const limit = current !== null && snapshot !== null ? Math.min(current, snapshot) : null;
  const today = current === null ? null : beijingDay(current);
  const snapshotDay = snapshot === null ? null : beijingDay(snapshot);
  const firstSeen = new Map(allGitHub.map(record => [record.id, stamp(record.firstSeenAt)]));
  // Find the first recorded batch in the full archive, not in the filtered view.
  // Its identity remains available even if the snapshot timestamp is damaged.
  const knownFirstSeen = [...firstSeen.values()].filter((time): time is number => time !== null && (current === null || time <= current));
  const initialTime = knownFirstSeen.length ? knownFirstSeen.reduce((a, b) => Math.min(a, b)) : null;
  const initialAt = initialTime === null ? null : new Date(initialTime).toISOString();
  const initialDay = initialTime === null ? null : beijingDay(initialTime);
  const isInitial = (record: GitHubSignal) => initialTime !== null && firstSeen.get(record.id) === initialTime;
  const initialIds = allGitHub.filter(isInitial).map(record => record.id);
  const todayIds = allGitHub.filter(record => {
    const time = firstSeen.get(record.id);
    return !isInitial(record) && time != null && limit !== null && time <= limit && beijingDay(time) === today;
  }).map(record => record.id);
  const global = {
    total: bucket("global-total", "库内 GitHub 项目", "Repositories in library", allGitHub.map(record => record.id)),
    today: bucket("global-today", "今日新入库", "Added today", todayIds),
    initial: bucket("global-initial", "推定初始基线", "Inferred initial baseline", initialIds),
  };
  const initialInScope = bucket("scope-initial", "当前筛选中的初始记录", "Initial records within filters", base.filter(isInitial).map(record => record.id));
  // For GitHub records, publishedAt is populated from the API's created_at.
  // It is a repository creation timestamp, not proof of when it became public.
  // Missing creation metadata must never fall back to collection or release time.
  const dateById = new Map(base.map(record => [record.id, stamp(githubDashboardDate(record, clock))]));
  let start: string | null = null, end = today;
  let rangeValid = true;
  if (range === "custom") {
    rangeValid = validDay(filters.from) && validDay(filters.to) && filters.from <= filters.to;
    if (rangeValid && today) { start = filters.from!; end = filters.to! < today ? filters.to! : today; }
    else { start = null; end = null; }
  } else if (today) {
    if (range === "all") {
      const validDates = [...dateById.values()].filter((time): time is number => time !== null && limit !== null && time <= limit);
      start = validDates.length ? beijingDay(validDates.reduce((a, b) => Math.min(a, b))) : today;
    } else start = shiftDay(today, 1 - range);
  }
  if (start && end && start > end) rangeValid = false;
  // Both clocks describe repository metadata that can predate this monitor.
  // The initial collection batch remains part of both filtered populations.
  const observedFrom = start && rangeValid ? start : null;
  const observedTo = end && snapshotDay && current !== null && rangeValid ? [end, snapshotDay, today!].sort()[0] : null;
  const excluded = {
    missing: bucket("excluded-missing", "日期缺失或无效", "Missing or invalid dates"),
    future: bucket("excluded-future", "晚于当前时间或快照", "After current time or snapshot"),
    outside: bucket("excluded-outside", "所选日期范围外", "Outside selected dates"),
    unavailable: bucket("excluded-unavailable", "日期范围或时间基准不可用", "Date range or time reference unavailable"),
  };
  const rows: GitHubSignal[] = [];
  for (const record of base) {
    const time = dateById.get(record.id);
    if (time == null) { add(excluded.missing, record.id); continue; }
    if (limit === null || !rangeValid || !start || !end) { add(excluded.unavailable, record.id); continue; }
    if (time > limit) { add(excluded.future, record.id); continue; }
    const day = beijingDay(time);
    if (day < start || day > end) { add(excluded.outside, record.id); continue; }
    rows.push(record);
  }
  const series: GitHubDashboardSeriesRow[] = [];
  const seriesGranularity = observedFrom && end && dayTime(end) - dayTime(observedFrom) >= 120 * DAY ? "month" : "day";
  const period = (day: string) => seriesGranularity === "month" ? day.slice(0, 7) : day;
  if (observedFrom && end && limit !== null && rangeValid && observedFrom <= end) {
    for (let date = period(observedFrom); date <= period(end); date = seriesGranularity === "month" ? nextMonth(date) : shiftDay(date, 1)) {
      const observed = observedTo !== null && date <= period(observedTo);
      series.push({ date, count: observed ? 0 : null, direct: observed ? 0 : null, candidate: observed ? 0 : null,
        recordIds: [], directRecordIds: [], candidateRecordIds: [], isToday: today !== null && date === period(today), observed });
    }
  }
  const byDay = new Map(series.map(point => [point.date, point]));
  for (const record of rows) {
    const point = byDay.get(period(beijingDay(dateById.get(record.id)!)));
    if (!point || !point.observed) continue;
    point.recordIds.push(record.id); point.count!++;
    if (record.relevance?.level === "direct") { point.directRecordIds.push(record.id); point.direct!++; }
    else { point.candidateRecordIds.push(record.id); point.candidate!++; }
  }
  // Reuse the tested metadata aggregations with the same UTC+8 calendar. Shifting
  // instants and reference together preserves chronology and changes day/month
  // boundaries only; the externally exposed asOf remains the actual snapshot.
  const shift = (value: string | null) => { const time = stamp(value); return time === null ? null : new Date(time + BEIJING_OFFSET).toISOString(); };
  const shifted = rows.map(record => ({ ...record, publishedAt: shift(record.publishedAt), pushedAt: shift(record.pushedAt), releasedAt: shift(record.releasedAt) }));
  const scoped = buildSignalDashboard(shifted, "github", limit === null ? "" : new Date(limit + BEIJING_OFFSET).toISOString());
  scoped.asOf = snapshot === null ? "" : new Date(snapshot).toISOString();
  return { global, rows, scoped, popularity: buildGitHubPopularity(rows), series, seriesGranularity, filters: { range, clock }, today, start, end, observedFrom, observedTo,
    initialAt, initialDay, initialInScope, now: current === null ? null : new Date(current).toISOString(),
    asOf: snapshot === null ? null : new Date(snapshot).toISOString(), snapshotDay,
    snapshotStale: today !== null && snapshotDay !== null && snapshotDay < today,
    snapshotInFuture: current !== null && snapshot !== null && snapshot > current,
    referenceDateValid: snapshot !== null, nowValid: current !== null, rangeValid, excluded };
}

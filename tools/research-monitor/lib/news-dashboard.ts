import type { NewsSignal, ResearchSignal, ResearchSignalsData } from "./research-signals";
import { buildSignalDashboard, type SignalDashboard, type SignalDashboardBucket } from "./signal-dashboard";

const DAY = 86_400_000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
export type NewsDashboardClock = "publication" | "discovery";
export interface NewsDashboardFilters {
  baseRecords?: readonly ResearchSignal[];
  range?: 7 | 30 | 90 | "all" | "custom";
  clock?: NewsDashboardClock;
  from?: string;
  to?: string;
}
export interface NewsDashboardSeriesRow {
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
export interface NewsDashboardModel {
  global: { total: SignalDashboardBucket; today: SignalDashboardBucket; initial: SignalDashboardBucket };
  rows: NewsSignal[];
  scoped: SignalDashboard;
  series: NewsDashboardSeriesRow[];
  seriesGranularity: "day" | "month";
  filters: { range: NonNullable<NewsDashboardFilters["range"]>; clock: NewsDashboardClock };
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
  excluded: {
    initial: SignalDashboardBucket;
    missing: SignalDashboardBucket;
    future: SignalDashboardBucket;
    outside: SignalDashboardBucket;
    unavailable: SignalDashboardBucket;
  };
}

function stamp(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10),
    midnight = Date.parse(`${day}T00:00:00Z`),
    time = Date.parse(value);
  return Number.isFinite(time) &&
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === day
    ? time
    : null;
}
function beijingDay(value: number): string {
  return new Date(value + BEIJING_OFFSET).toISOString().slice(0, 10);
}
function dayTime(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}
function validDay(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && stamp(value) !== null;
}
function shiftDay(value: string, days: number): string {
  return new Date(dayTime(value) + days * DAY).toISOString().slice(0, 10);
}
function nextMonth(value: string): string {
  const date = new Date(dayTime(`${value}-01`));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}
function bucket(
  id: string,
  labelZh: string,
  labelEn: string,
  recordIds: string[] = [],
): SignalDashboardBucket {
  return { id, labelZh, labelEn, recordIds, count: recordIds.length };
}
function add(target: SignalDashboardBucket, id: string): void {
  target.recordIds.push(id);
  target.count++;
}

/** Publication dates come from the source; collection dates never substitute for them. */
export function newsDashboardDate(record: NewsSignal, clock: NewsDashboardClock): string | null {
  const time = stamp(clock === "publication" ? record.publishedAt : record.firstSeenAt);
  return time === null ? null : new Date(time).toISOString();
}

/**
 * News observation does not advance when only GitHub refreshes the shared
 * snapshot. Successful empty searches establish observation; failed checks do
 * not. Newly observed news can advance a partial run without waiting for every
 * query to succeed. Future source timestamps cannot exceed this snapshot.
 */
export function newsDashboardAsOf(snapshot: ResearchSignalsData | null): string | null {
  const generated = stamp(snapshot?.generatedAt);
  if (!snapshot || generated === null) return null;
  let latest: number | null = null;
  const observe = (value: string | null) => {
    const time = stamp(value);
    if (time !== null && time <= generated && (latest === null || time > latest)) latest = time;
  };
  for (const source of snapshot.sources)
    if (source.kind === "news") {
      observe(source.lastSuccessAt);
      if (source.status === "ok") observe(source.checkedAt);
    }
  for (const record of snapshot.records) if (record.kind === "news") observe(record.observedAt);
  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * Summarize a public-news archive, not independent scientific events. firstSeenAt
 * persists through collection refreshes. With no stored initial-import marker,
 * the earliest exact full-library batch is only an inferred collection baseline.
 * That baseline and global counts remain independent of the selected filters.
 */
export function buildNewsDashboard(
  allRecords: readonly ResearchSignal[],
  filters: NewsDashboardFilters = {},
  now: Date | string = new Date(),
  asOf?: string,
): NewsDashboardModel {
  const all = new Map<string, NewsSignal>();
  for (const record of allRecords)
    if (record.kind === "news" && !all.has(record.id)) all.set(record.id, record);
  const allNews = [...all.values()];
  const selected = new Set(
    (filters.baseRecords ?? allNews).filter((record) => record.kind === "news").map((record) => record.id),
  );
  const base = allNews.filter((record) => selected.has(record.id));
  const range = filters.range ?? 30,
    clock = filters.clock ?? "publication";
  const current = stamp(now),
    snapshot = stamp(asOf);
  const limit = current !== null && snapshot !== null ? Math.min(current, snapshot) : null;
  const today = current === null ? null : beijingDay(current);
  const snapshotDay = snapshot === null ? null : beijingDay(snapshot);
  const firstSeen = new Map(allNews.map((record) => [record.id, stamp(record.firstSeenAt)]));
  const knownFirstSeen = [...firstSeen.values()].filter(
    (time): time is number => time !== null && (current === null || time <= current),
  );
  const initialTime = knownFirstSeen.length ? knownFirstSeen.reduce((a, b) => Math.min(a, b)) : null;
  const initialAt = initialTime === null ? null : new Date(initialTime).toISOString();
  const initialDay = initialTime === null ? null : beijingDay(initialTime);
  const isInitial = (record: NewsSignal) => initialTime !== null && firstSeen.get(record.id) === initialTime;
  const initialIds = allNews.filter(isInitial).map((record) => record.id);
  const todayIds = allNews
    .filter((record) => {
      const time = firstSeen.get(record.id);
      return (
        !isInitial(record) && time != null && limit !== null && time <= limit && beijingDay(time) === today
      );
    })
    .map((record) => record.id);
  const global = {
    total: bucket(
      "global-total",
      "库内公开消息",
      "News records in library",
      allNews.map((record) => record.id),
    ),
    today: bucket("global-today", "今日新入库", "Added today", todayIds),
    initial: bucket("global-initial", "推定初始基线", "Inferred initial baseline", initialIds),
  };
  const initialInScope = bucket(
    "scope-initial",
    "当前筛选中的初始记录",
    "Initial records within filters",
    base.filter(isInitial).map((record) => record.id),
  );
  const dateById = new Map(base.map((record) => [record.id, stamp(newsDashboardDate(record, clock))]));
  let start: string | null = null,
    end = today;
  let rangeValid = true;
  if (range === "custom") {
    rangeValid = validDay(filters.from) && validDay(filters.to) && filters.from <= filters.to;
    if (rangeValid && today) {
      start = filters.from!;
      end = filters.to! < today ? filters.to! : today;
    } else {
      start = null;
      end = null;
    }
  } else if (today) {
    if (range === "all") {
      const validDates = [...dateById.values()].filter(
        (time): time is number => time !== null && limit !== null && time <= limit,
      );
      start =
        clock === "discovery"
          ? (initialDay ?? today)
          : validDates.length
            ? beijingDay(validDates.reduce((a, b) => Math.min(a, b)))
            : today;
    } else start = shiftDay(today, 1 - range);
  }
  if (start && end && start > end) rangeValid = false;
  // Collection charts start at actual observation. Publication metadata can
  // predate this monitor, so the publication clock keeps its requested window.
  const observedFrom =
    start && rangeValid
      ? clock === "discovery"
        ? initialDay
          ? initialDay > start
            ? initialDay
            : start
          : null
        : start
      : null;
  const observedTo =
    end && snapshotDay && current !== null && rangeValid ? [end, snapshotDay, today!].sort()[0] : null;
  const excluded = {
    initial: bucket("excluded-initial", "初始采集批次另列", "Initial collection batch shown separately"),
    missing: bucket("excluded-missing", "日期缺失或无效", "Missing or invalid dates"),
    future: bucket("excluded-future", "晚于当前时间或快照", "After current time or snapshot"),
    outside: bucket("excluded-outside", "所选日期范围外", "Outside selected dates"),
    unavailable: bucket(
      "excluded-unavailable",
      "日期范围或时间基准不可用",
      "Date range or time reference unavailable",
    ),
  };
  const rows: NewsSignal[] = [];
  for (const record of base) {
    const time = dateById.get(record.id);
    if (time == null) {
      add(excluded.missing, record.id);
      continue;
    }
    if (limit === null || !rangeValid || !start || !end) {
      add(excluded.unavailable, record.id);
      continue;
    }
    if (time > limit) {
      add(excluded.future, record.id);
      continue;
    }
    if (clock === "discovery" && isInitial(record)) {
      add(excluded.initial, record.id);
      continue;
    }
    const day = beijingDay(time);
    if (day < start || day > end) {
      add(excluded.outside, record.id);
      continue;
    }
    rows.push(record);
  }
  const series: NewsDashboardSeriesRow[] = [];
  const seriesGranularity =
    observedFrom && end && dayTime(end) - dayTime(observedFrom) >= 120 * DAY ? "month" : "day";
  const period = (day: string) => (seriesGranularity === "month" ? day.slice(0, 7) : day);
  if (observedFrom && end && limit !== null && rangeValid && observedFrom <= end) {
    for (
      let date = period(observedFrom);
      date <= period(end);
      date = seriesGranularity === "month" ? nextMonth(date) : shiftDay(date, 1)
    ) {
      const observed = observedTo !== null && date <= period(observedTo);
      series.push({
        date,
        count: observed ? 0 : null,
        direct: observed ? 0 : null,
        candidate: observed ? 0 : null,
        recordIds: [],
        directRecordIds: [],
        candidateRecordIds: [],
        isToday: today !== null && date === period(today),
        observed,
      });
    }
  }
  const byPeriod = new Map(series.map((point) => [point.date, point]));
  for (const record of rows) {
    const point = byPeriod.get(period(beijingDay(dateById.get(record.id)!)));
    if (!point || !point.observed) continue;
    point.recordIds.push(record.id);
    point.count!++;
    if (record.relevance?.level === "direct") {
      point.directRecordIds.push(record.id);
      point.direct!++;
    } else {
      point.candidateRecordIds.push(record.id);
      point.candidate!++;
    }
  }
  // Shift source publication dates and reference together so the existing
  // metadata aggregates (including recent30 and month bins) use Beijing days.
  // Publisher metrics remain distinct-name counts, independent of date shifting.
  const shift = (value: string | null) => {
    const time = stamp(value);
    return time === null ? null : new Date(time + BEIJING_OFFSET).toISOString();
  };
  const shifted = rows.map((record) => ({ ...record, publishedAt: shift(record.publishedAt) }));
  const scoped = buildSignalDashboard(
    shifted,
    "news",
    limit === null ? "" : new Date(limit + BEIJING_OFFSET).toISOString(),
  );
  scoped.asOf = snapshot === null ? "" : new Date(snapshot).toISOString();
  // The selected time window already expresses recency. Use the other headline
  // slots for model-related and tooling records, keeping publisher names distinct.
  scoped.metrics = [
    scoped.metrics.find((metric) => metric.id === "total")!,
    scoped.metrics.find((metric) => metric.id === "publishers")!,
    scoped.newsTypes.find((type) => type.id === "model")!,
    scoped.newsTypes.find((type) => type.id === "tooling")!,
  ];
  return {
    global,
    rows,
    scoped,
    series,
    seriesGranularity,
    filters: { range, clock },
    today,
    start,
    end,
    observedFrom,
    observedTo,
    initialAt,
    initialDay,
    initialInScope,
    now: current === null ? null : new Date(current).toISOString(),
    asOf: snapshot === null ? null : new Date(snapshot).toISOString(),
    snapshotDay,
    snapshotStale: today !== null && snapshotDay !== null && snapshotDay < today,
    snapshotInFuture: current !== null && snapshot !== null && snapshot > current,
    referenceDateValid: snapshot !== null,
    nowValid: current !== null,
    rangeValid,
    excluded,
  };
}

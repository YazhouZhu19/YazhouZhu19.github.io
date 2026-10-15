import { safeSignalUrl, signalDate, type ResearchSignal } from "./research-signals";
import { getSignalBrowseCategories, getSignalBrowseCategoryIds } from "./signal-browse-categories";

export interface SignalDashboardBucket {
  id: string;
  labelZh: string;
  labelEn: string;
  // Usually the number of recordIds; the publisher KPI counts distinct names.
  count: number;
  recordIds: string[];
}

export interface SignalDashboard {
  kind: ResearchSignal["kind"];
  asOf: string;
  referenceDateValid: boolean;
  total: number;
  recordIds: string[];
  metrics: SignalDashboardBucket[];
  categories: SignalDashboardBucket[];
  timeline: {
    months: SignalDashboardBucket[];
    missing: SignalDashboardBucket;
    future: SignalDashboardBucket;
    older: SignalDashboardBucket;
  };
  languages: SignalDashboardBucket[];
  maintenance: SignalDashboardBucket[];
  newsTypes: SignalDashboardBucket[];
  publishers: SignalDashboardBucket[];
}

const DAY = 24 * 60 * 60 * 1000;

function timestamp(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  const result = Date.parse(value);
  // Date.parse normalizes impossible calendar days, e.g. February 30.
  return Number.isFinite(result) && Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === day ? result : null;
}

function bucket(id: string, labelZh: string, labelEn: string, recordIds: string[] = []): SignalDashboardBucket {
  return { id, labelZh, labelEn, count: recordIds.length, recordIds };
}

function add(target: SignalDashboardBucket, recordId: string): void {
  target.recordIds.push(recordId);
  target.count++;
}

function utcDayStart(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function withinCalendarDays(value: number | null, asOf: number | null, days: number): boolean {
  return value !== null && asOf !== null && value <= asOf && value >= utcDayStart(asOf) - (days - 1) * DAY;
}

function named(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name && !/^(?:unknown|unspecified|n\/?a|none|null|未知|未注明|未提供)$/i.test(name) ? name : null;
}

function topBuckets(records: ResearchSignal[], getName: (record: ResearchSignal) => string | null,
  limit: number, prefix: string): SignalDashboardBucket[] {
  const groups = new Map<string, SignalDashboardBucket>();
  const unknown = bucket(`${prefix}:unknown`, "未注明", "Unknown");
  for (const record of records) {
    const name = named(getName(record));
    if (!name) { add(unknown, record.id); continue; }
    const key = name.toLocaleLowerCase("en");
    let group = groups.get(key);
    if (!group) { group = bucket(`${prefix}:value:${key}`, name, name); groups.set(key, group); }
    add(group, record.id);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.labelEn.localeCompare(b.labelEn, "en"));
  const rest = sorted.slice(limit).flatMap(group => group.recordIds);
  return [...sorted.slice(0, limit), bucket(`${prefix}:other`, "其他", "Other", rest), unknown];
}

function activityTimestamp(record: ResearchSignal): number | null {
  if (record.kind === "news") return timestamp(record.publishedAt);
  // Normalizing first makes signalDate's ordering independent of UTC offsets and
  // lets a valid timestamp remain usable when another metadata field is invalid.
  const normalize = (value: string | null) => {
    const time = timestamp(value);
    return time === null ? null : new Date(time).toISOString();
  };
  return timestamp(signalDate({ ...record, pushedAt: normalize(record.pushedAt),
    releasedAt: normalize(record.releasedAt), publishedAt: normalize(record.publishedAt) }));
}

/** The library and dashboard share the same validated UTC activity date. */
export function signalDashboardDate(record: ResearchSignal): string | null {
  const value = activityTimestamp(record);
  return value === null ? null : new Date(value).toISOString();
}

/**
 * Summarize one already-filtered population. Dates use the snapshot's UTC
 * calendar, never the viewer's clock. Category memberships can overlap; the
 * remaining chart partitions count each record once. These are archive
 * metadata counts, not estimates of field prevalence or development volume.
 */
export function buildSignalDashboard(input: readonly ResearchSignal[], kind: ResearchSignal["kind"], asOf: string): SignalDashboard {
  const unique = new Map<string, ResearchSignal>();
  for (const record of input) if (record.kind === kind && !unique.has(record.id)) unique.set(record.id, record);
  const records = [...unique.values()];
  const recordIds = records.map(record => record.id);
  const reference = timestamp(asOf);
  const categories = getSignalBrowseCategories(kind).map(category => bucket(category.id, category.labelZh, category.labelEn));
  const categoryById = new Map(categories.map(category => [category.id, category]));
  for (const record of records) for (const id of new Set(getSignalBrowseCategoryIds(record))) {
    const category = categoryById.get(id);
    if (category) add(category, record.id);
  }

  const timeline: SignalDashboard["timeline"] = {
    months: [],
    missing: bucket("missing", reference === null ? "参考日期无效，无法归月" : "日期缺失或无效",
      reference === null ? "Invalid reference date" : "Missing or invalid date"),
    future: bucket("future", "晚于快照时间", "After snapshot time"),
    older: bucket("older", "早于图示月份", "Before displayed months"),
  };
  if (reference !== null) {
    const date = new Date(reference);
    for (let offset = -11; offset <= 0; offset++) {
      const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
      timeline.months.push(bucket(month, month, month));
    }
  }
  const monthById = new Map(timeline.months.map(month => [month.id, month]));
  for (const record of records) {
    const activity = activityTimestamp(record);
    if (reference === null || activity === null) { add(timeline.missing, record.id); continue; }
    if (activity > reference) { add(timeline.future, record.id); continue; }
    const month = new Date(activity).toISOString().slice(0, 7);
    add(monthById.get(month) ?? timeline.older, record.id);
  }

  const total = bucket("total", kind === "github" ? "当前范围项目" : "当前范围消息",
    kind === "github" ? "Repositories in scope" : "News records in scope", [...recordIds]);
  let metrics: SignalDashboardBucket[];
  let languages: SignalDashboardBucket[] = [];
  let maintenance: SignalDashboardBucket[] = [];
  let newsTypes: SignalDashboardBucket[] = [];
  let publishers: SignalDashboardBucket[] = [];
  if (kind === "github") {
    const github = records.filter(record => record.kind === "github");
    const recent = github.filter(record => withinCalendarDays(timestamp(record.pushedAt), reference, 90)).map(record => record.id);
    const licensed = github.filter(record => named(record.license) && record.license!.trim().toUpperCase() !== "NOASSERTION").map(record => record.id);
    const released = github.filter(record => {
      const release = timestamp(record.releasedAt);
      return reference !== null && release !== null && release <= reference && safeSignalUrl(record.releaseUrl);
    }).map(record => record.id);
    metrics = [total, bucket("recent90", "近 90 天有推送", "Pushed in last 90 days", recent),
      bucket("licensed", "已注明许可证", "License identified", licensed),
      bucket("released", "收录 Release 信息", "With release metadata", released)];
    languages = topBuckets(github, record => record.kind === "github" ? record.language : null, 6, "language");
    maintenance = [bucket("archived", "已归档", "Archived"), bucket("recent90", "未归档 · 近 90 天推送", "Not archived · pushed within 90 days"),
      bucket("older", "未归档 · 较早推送", "Not archived · older push"),
      bucket("unknown", "未归档 · 推送日期待核实", "Not archived · push date unverified")];
    for (const record of github) {
      const pushed = timestamp(record.pushedAt);
      const index = record.archived ? 0 : withinCalendarDays(pushed, reference, 90) ? 1 :
        reference !== null && pushed !== null && pushed <= reference ? 2 : 3;
      add(maintenance[index], record.id);
    }
  } else {
    const news = records.filter(record => record.kind === "news");
    const namedRecords = news.filter(record => named(record.publisher));
    const publisherCount = new Set(namedRecords.map(record => named(record.publisher)!.toLocaleLowerCase("en"))).size;
    const publisherMetric = bucket("publishers", "发布者名称", "Publisher names", namedRecords.map(record => record.id));
    publisherMetric.count = publisherCount;
    metrics = [total, publisherMetric,
      bucket("recent30", "近 30 天发布", "Published in last 30 days", news.filter(record => withinCalendarDays(timestamp(record.publishedAt), reference, 30)).map(record => record.id)),
      bucket("original", "有原文链接", "With original links", news.filter(record => safeSignalUrl(record.originalUrl)).map(record => record.id))];
    publishers = topBuckets(news, record => record.publisher, 8, "publisher");
    newsTypes = [bucket("model", "模型相关", "Model-related"), bucket("research", "研究进展", "Research progress"), bucket("tooling", "工具与平台", "Tools & platforms")];
    const typeById = new Map(newsTypes.map(type => [type.id, type]));
    for (const record of news) add(typeById.get(record.newsType)!, record.id);
  }
  return { kind, asOf, referenceDateValid: reference !== null, total: records.length, recordIds, metrics,
    categories, timeline, languages, maintenance, newsTypes, publishers };
}

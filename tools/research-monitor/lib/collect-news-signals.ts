import { NEWS_DISCOVERY_VERSION, NEWS_QUERIES } from "./news-discovery";
import { classifyNewsRelevance } from "./signal-relevance";
import type { NewsSignal, ResearchSignalsData, SignalSourceState } from "./research-signals";

export type NewsWindow = { queryId: string; from: string; to: string };
export type NewsDiscoveryState = { catalogVersion: string; cursor: number; queue: NewsWindow[]; completedWindows: number };
type FetchText = (url: string) => Promise<{ body: string; status: number }>;
type ParseRss = (body: string, sourceId: string, url: string, now: string, days: number) => { records: NewsSignal[]; received: number };
const DAY = 86400000, CACHE_MS = 6 * 3600000;
const day = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
export const NEWS_REQUEST_BUDGET = 36, NEWS_BACKFILL_BUDGET = 120;

/** Google News has no public pagination contract. Split dense date windows instead. */
export function newsWindowUrl(query: typeof NEWS_QUERIES[number], window: NewsWindow): string {
  const start = Date.parse(window.from), end = Date.parse(window.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window.from) || !/^\d{4}-\d{2}-\d{2}$/.test(window.to) || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("检索新闻时间窗口无效");
  return "https://news.google.com/rss/search?" + new URLSearchParams({ q: `${query.query} after:${window.from} before:${window.to}`, hl: query.hl, gl: query.gl, ceid: query.ceid });
}
export function newsBackfillPlan(now: string, days: number): NewsWindow[] {
  if (!Number.isSafeInteger(days) || days < 1 || days > 730) throw new Error("检索时间跨度必须为 1–730 天");
  const end = Date.parse(now.slice(0, 10)) + DAY, start = end - (days + 1) * DAY;
  const windows: NewsWindow[] = [];
  for (let to = end; to > start; to -= 30 * DAY) {
    for (const query of NEWS_QUERIES) windows.push({ queryId: query.id, from: day(Math.max(start, to - 30 * DAY)), to: day(to) });
  }
  return windows;
}
const key = (window: NewsWindow) => `${window.queryId}:${window.from}:${window.to}`;

export async function collectNewsWindows(previous: ResearchSignalsData, now: string, days: number, fetchText: FetchText, parseRss: ParseRss,
  options: { force?: boolean; discoveryMode?: "incremental" | "backfill"; wait?: (ms: number) => Promise<void> } = {}) {
  const version = `${NEWS_DISCOVERY_VERSION}:${days}`;
  const saved = previous.discoveryState?.news;
  const matching = saved?.catalogVersion === version;
  const cutoff = day(Date.parse(now.slice(0, 10)) - days * DAY);
  const queue: NewsWindow[] = matching ? saved.queue.filter(item => item.to > cutoff)
    .map(item => ({ ...item, from: item.from < cutoff ? cutoff : item.from })) : newsBackfillPlan(now, days);
  const queryMap = new Map(NEWS_QUERIES.map(query => [query.id, query]));
  const current = newsBackfillPlan(now, Math.min(days, 29));
  // If collection was offline for more than the recent refresh window, restore
  // the gap even after the previous historical queue had been exhausted.
  if (matching) {
    const stale = new Map(NEWS_QUERIES.flatMap(query => {
      const source = previous.sources.find(item => item.id === query.id);
      const checked = source ? Date.parse(source.checkedAt) : NaN;
      return Number.isFinite(checked) && Date.parse(now) - checked > 29 * DAY ? [[query.id, checked] as const] : [];
    }));
    const missingDays = Math.min(days, Math.max(0, ...[...stale.values()].map(checked => Math.ceil((Date.parse(now) - checked) / DAY) + 1)));
    const seen = new Set(queue.map(key));
    if (missingDays) for (const window of newsBackfillPlan(now, missingDays)) {
      if (stale.has(window.queryId) && Date.parse(window.to) > stale.get(window.queryId)! && !seen.has(key(window))) {
        queue.push(window); seen.add(key(window));
      }
    }
  }
  // Always refresh the recent window; historical windows retain their own queue.
  const fresh = current.filter(window => {
    const source = previous.sources.find(item => item.id === window.queryId);
    return options.force || !matching || source?.status !== "ok" || Date.parse(now) - Date.parse(source.checkedAt) >= CACHE_MS || Date.parse(now) < Date.parse(source.checkedAt);
  });
  if (!fresh.length && matching && !options.force) return { records: [] as NewsSignal[], sources: previous.sources.filter(source => queryMap.has(source.id)), state: saved };
  const freshKeys = new Set(fresh.map(key));
  const work = [...fresh, ...queue.filter(item => !freshKeys.has(key(item)))];
  const pending: NewsWindow[] = [], records = new Map<string, NewsSignal>();
  const stats = new Map<string, { received: number; requests: number; errors: string[]; dense: number }>();
  const budget = options.discoveryMode === "backfill" ? NEWS_BACKFILL_BUDGET : NEWS_REQUEST_BUDGET;
  const pause = options.wait ?? (async () => {});
  let completed = matching ? saved.completedWindows : 0, cursor = matching ? saved.cursor : 0, requests = 0;
  while (work.length && requests < budget) {
    const window = work.shift()!, query = queryMap.get(window.queryId);
    if (!query) continue;
    const entry = stats.get(query.id) ?? { received: 0, requests: 0, errors: [], dense: 0 };
    stats.set(query.id, entry);
    if (requests) await pause(800);
    requests++; entry.requests++; cursor++;
    const url = newsWindowUrl(query, window);
    try {
      const parsed = parseRss((await fetchText(url)).body, query.id, url, now, days);
      entry.received += parsed.received;
      for (const record of parsed.records) {
        const published = record.publishedAt ? Date.parse(record.publishedAt) : NaN;
        // Search can ignore date operators; enforce them on the returned metadata.
        if (!(published >= Date.parse(window.from) && published < Date.parse(window.to))) continue;
        const relevance = classifyNewsRelevance({ title: record.title, summary: record.summary });
        if (!relevance) continue;
        const old = records.get(record.id);
        records.set(record.id, { ...record, relevance, discoveryGroups: [...new Set([...(old?.discoveryGroups ?? []), query.groupId ?? query.id])] });
      }
      const span = Date.parse(window.to) - Date.parse(window.from);
      if (parsed.received >= 90) {
        entry.dense++;
        if (span > DAY) {
          const midpoint = day(Date.parse(window.from) + Math.floor(span / DAY / 2) * DAY);
          work.push({ ...window, to: midpoint }, { ...window, from: midpoint });
        } else {
          // Preserve saturated day windows for a later pass; never claim exhaustiveness.
          pending.push(window);
        }
      } else completed++;
    } catch {
      entry.errors.push("Google RSS 本窗口采集失败；保留旧记录并等待续查");
      pending.push(window);
    }
  }
  const dedup = new Map([...work, ...pending].map(window => [key(window), window]));
  if (dedup.size > 6000) throw new Error("检索新闻待处理窗口超过上限；原快照保持不变");
  const state: NewsDiscoveryState = { catalogVersion: version, cursor, queue: [...dedup.values()], completedWindows: completed };
  const sources: SignalSourceState[] = NEWS_QUERIES.map(query => {
    const entry = stats.get(query.id), old = previous.sources.find(source => source.id === query.id);
    const window = current.find(item => item.queryId === query.id)!;
    if (!entry && old) return old;
    const errors = entry?.errors ?? [];
    return { id: query.id, name: query.name, kind: "news", url: newsWindowUrl(query, window),
      status: errors.length ? errors.length === entry!.requests ? "error" : "partial" : "ok", checkedAt: entry ? now : old?.checkedAt ?? now,
      lastSuccessAt: entry && !errors.length ? now : old?.lastSuccessAt ?? null,
      received: entry?.received ?? 0, retained: 0, error: errors.length ? [...new Set(errors)].join("；") : null,
      coverage: `Google News 多维检索目录 ${NEWS_DISCOVERY_VERSION}；${NEWS_QUERIES.length} 条中英查询，近 ${days} 天按月分窗，密集结果继续按天拆分。本查询本轮处理 ${entry?.requests ?? 0} 个窗口，密集窗口 ${entry?.dense ?? 0}；所有查询合计尚有 ${state.queue.length} 个窗口待续查。高相关与候选由可解释词义规则区分；Google 索引及结果上限仍会漏收，原始正文未核验。`,
    };
  });
  return { records: [...records.values()], sources, state };
}

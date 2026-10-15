import { NEWS_DISCOVERY_VERSION, NEWS_QUERIES } from "./news-discovery";
import { classifyNewsRelevance } from "./signal-relevance";
import type { NewsSignal, ResearchSignalsData, SignalSourceState } from "./research-signals";

export type NewsWindow = { queryId: string; from: string; to: string };
export type NewsDiscoveryState = { catalogVersion: string; cursor: number; queue: NewsWindow[]; completedWindows: number; recentCheckedAt?: Record<string, string> };
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
  const queryMap = new Map(NEWS_QUERIES.map(query => [query.id, query]));
  const sourceMap = new Map(previous.sources.map(source => [source.id, source]));
  const cutoff = day(Date.parse(now.slice(0, 10)) - days * DAY);
  const queue: NewsWindow[] = matching ? saved.queue.filter(item => queryMap.has(item.queryId) && item.to > cutoff)
    .map(item => ({ ...item, from: item.from < cutoff ? cutoff : item.from })) : newsBackfillPlan(now, days);
  const current = newsBackfillPlan(now, Math.min(days, 29));
  const recentCheckedAt = matching ? Object.fromEntries(Object.entries(saved.recentCheckedAt ?? {}).filter(([id]) => queryMap.has(id))) : {};
  // If collection was offline for more than the recent refresh window, restore
  // the gap even after the previous historical queue had been exhausted.
  if (matching) {
    const stale = new Map(NEWS_QUERIES.flatMap(query => {
      const source = sourceMap.get(query.id);
      const checked = source?.lastSuccessAt ? Date.parse(source.lastSuccessAt) : NaN;
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
  // Pending windows are never hidden by the refresh cache. Recent requests are
  // ordered by actual last attempt, so new/neglected queries get their turn even
  // when the catalogue is larger than one run's budget.
  const queuedKeys = new Set(queue.map(key));
  const lastAttempt = (id: string) => {
    // Source checks also include historical requests. Once this map exists,
    // only a real recent-window attempt can extend the refresh cache.
    const checked = matching && saved.recentCheckedAt !== undefined ? recentCheckedAt[id] : sourceMap.get(id)?.checkedAt;
    const stamp = checked ? Date.parse(checked) : NaN;
    // A clock rollback or future saved timestamp needs an early real check,
    // rather than sorting after every ordinarily expired query forever.
    return Number.isFinite(stamp) && stamp <= Date.parse(now) ? stamp : -Infinity;
  };
  const fresh = current.filter(window => {
    const checked = lastAttempt(window.queryId);
    return queuedKeys.has(key(window)) || options.force || !matching || Date.parse(now) - checked >= CACHE_MS || Date.parse(now) < checked;
  });
  // Rotate equal-age queries as well: repeated failures must not pin the first
  // catalogue entries to every run's limited refresh slots.
  const rotation = (matching ? saved.cursor : 0) % NEWS_QUERIES.length;
  const order = new Map(NEWS_QUERIES.map((query, index) => [query.id, (index - rotation + NEWS_QUERIES.length) % NEWS_QUERIES.length]));
  fresh.sort((a, b) => {
    const left = lastAttempt(a.queryId), right = lastAttempt(b.queryId);
    return left === right ? order.get(a.queryId)! - order.get(b.queryId)! : left < right ? -1 : 1;
  });
  const freshKeys = new Set(fresh.map(key));
  const history = [...new Map(queue.filter(item => !freshKeys.has(key(item))).map(window => [key(window), window])).values()];
  const pending: NewsWindow[] = [], records = new Map<string, NewsSignal>();
  const stats = new Map<string, { received: number; requests: number; successes: number; errors: string[]; dense: number }>();
  const budget = options.discoveryMode === "backfill" ? NEWS_BACKFILL_BUDGET : NEWS_REQUEST_BUDGET;
  const pause = options.wait ?? (async () => {});
  let completed = matching ? saved.completedWindows : 0, cursor = matching ? saved.cursor : 0, requests = 0, successes = 0;
  while ((fresh.length || history.length) && requests < budget) {
    // Two recent windows then one historical window; either queue can borrow
    // unused slots. Historical/split/failed work remains FIFO across runs.
    const lane = fresh.length && (!history.length || requests % 3 !== 2) ? fresh : history;
    const window = lane.shift()!, query = queryMap.get(window.queryId);
    if (!query) continue;
    const entry = stats.get(query.id) ?? { received: 0, requests: 0, successes: 0, errors: [], dense: 0 };
    stats.set(query.id, entry);
    if (requests) await pause(800);
    requests++; entry.requests++; cursor++;
    if (lane === fresh) recentCheckedAt[query.id] = now;
    const url = newsWindowUrl(query, window);
    try {
      const response = await fetchText(url);
      if (response.status < 200 || response.status >= 300) throw new Error("Google RSS request failed");
      const parsed = parseRss(response.body, query.id, url, now, days);
      successes++; entry.successes++;
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
          history.push({ ...window, to: midpoint }, { ...window, from: midpoint });
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
  const dedup = new Map([...fresh, ...history, ...pending].map(window => [key(window), window]));
  if (dedup.size > 6000) throw new Error("检索新闻待处理窗口超过上限；原快照保持不变");
  const state: NewsDiscoveryState = { catalogVersion: version, cursor, queue: [...dedup.values()], completedWindows: completed, recentCheckedAt };
  const sources: SignalSourceState[] = NEWS_QUERIES.map(query => {
    const entry = stats.get(query.id), old = sourceMap.get(query.id);
    const window = current.find(item => item.queryId === query.id)!;
    const errors = entry?.errors ?? [];
    const remaining = state.queue.filter(item => item.queryId === query.id).length;
    const coverage = `Google News 多维检索目录 ${NEWS_DISCOVERY_VERSION}；${NEWS_QUERIES.length} 条中英查询，近 ${days} 天按月分窗，密集结果继续按天拆分。近期与历史窗口按 2:1 分配请求，空闲配额互借；本查询本轮处理 ${entry?.requests ?? 0} 个窗口，成功 ${entry?.successes ?? 0} 个，密集窗口 ${entry?.dense ?? 0}，待续查 ${remaining} 个；所有查询合计待续查 ${state.queue.length} 个。${!entry && !old ? "尚未请求，等待轮转检索。" : !entry ? "本轮未请求，保留上次实际检查时间。" : ""}高相关与候选由可解释词义规则区分；Google 索引及结果上限仍会漏收，原始正文未核验。`;
    if (!entry && old) return { ...old, coverage };
    return { id: query.id, name: query.name, kind: "news", url: newsWindowUrl(query, window),
      status: !entry ? "pending" : !entry.successes ? "error" : errors.length || remaining ? "partial" : "ok", checkedAt: entry ? now : null,
      lastSuccessAt: entry?.successes ? now : old?.lastSuccessAt ?? null,
      received: entry?.received ?? 0, retained: 0, error: errors.length ? [...new Set(errors)].join("；") : null,
      coverage,
    };
  });
  return { records: [...records.values()], sources, state, attemptStats: { requests, successes } };
}

import { createHash } from "node:crypto";
import { NEWS_FEED_SOURCES, type NewsFeedSource } from "./news-sources";
import { classifyNewsRelevance } from "./signal-relevance";
import { safeSignalUrl, type NewsSignal, type ResearchSignal, type ResearchSignalsData, type SignalSourceState } from "./research-signals";

type FetchText = (url: string) => Promise<{ body: string; status: number }>;
const DAY = 86400000, CACHE_MS = 6 * 3600000;
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function decode(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/gi, (_, code: string) => {
    if (code.startsWith("#")) {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" } as Record<string, string>)[code.toLowerCase()] ?? "";
  });
}
const plain = (value: string) => clean(decode(decode(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
const tag = (value: string, name: string) => value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
const attribute = (value: string, name: string) => value.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ?? "";
function stamp(value: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  const rfc = value.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (!iso && !rfc) return null;
  if (iso && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  if (rfc && !/(?:GMT|UTC|UT|[ECMP][SD]T|[+-]\d{4})$/i.test(value.trim())) return null;
  const year = Number(iso?.[1] ?? rfc![3]), month = iso ? Number(iso[2]) : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(rfc![2].toLowerCase()) + 1;
  const day = Number(iso?.[3] ?? rfc![1]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return null;
  return new Date(value).toISOString();
}
const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const hostMatches = (hostname: string, allowed: string[]) => allowed.some(host => hostname === host || hostname.endsWith(`.${host}`));

function articleUrl(value: string, source: NewsFeedSource): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(decode(value).trim(), source.homepage);
    if (!hostMatches(url.hostname, source.articleHosts)) return null;
    // Some established feeds still emit HTTP links to their own HTTPS site.
    if (url.protocol === "http:") url.protocol = "https:";
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(name)) url.searchParams.delete(name);
    return safeSignalUrl(url.href) ? url.href : null;
  } catch { return null; }
}

/** Parse metadata only. Never fetch article HTML, execute markup, or expand XML entities. */
export function parsePublisherFeed(body: string, source: NewsFeedSource, now: string, days: number) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 730 || !stamp(now)) throw new Error("公开订阅源时间范围无效");
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("公开订阅源含不支持的 XML 声明");
  body = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  const rss = /<rss\b/i.test(body) && /<\/rss>\s*$/i.test(body) && /<channel\b/i.test(body) && /<\/channel>/i.test(body);
  const atom = /<feed\b/i.test(body) && /<\/feed>\s*$/i.test(body);
  if ((!rss && !atom) || !tag(body, "title")) throw new Error("公开订阅源不是完整 RSS / Atom");
  const element = rss ? "item" : "entry";
  const entries = [...body.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`, "gi"))];
  if (entries.length !== (body.match(new RegExp(`<${element}\\b`, "gi")) ?? []).length || entries.length > 1000) throw new Error("公开订阅源条目不完整或超过上限");
  const records = new Map<string, NewsSignal>();
  let invalid = 0;
  for (const [, entry] of entries) {
    const title = plain(tag(entry, "title")).slice(0, 500);
    const publishedAt = stamp(plain(rss ? tag(entry, "pubDate") || tag(entry, "dc:date") : tag(entry, "published")));
    const updated = atom ? stamp(plain(tag(entry, "updated"))) : null;
    const updatedAt = updated && Date.parse(updated) <= Date.parse(now) ? updated : null;
    const links = [...entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map(match => match[1]);
    const atomLink = links.find(link => ["", "alternate"].includes(attribute(link, "rel")) && !/application\/(?:atom|rss)\+xml/i.test(attribute(link, "type")));
    const url = articleUrl(rss ? tag(entry, "link") : attribute(atomLink ?? "", "href"), source);
    if (!title || !(publishedAt || updatedAt) || !url) { invalid++; continue; }
    const age = Date.parse(now) - Date.parse(publishedAt || updatedAt!);
    if (age < 0 || age > (days + 1) * DAY) continue;
    const summary = plain(rss ? tag(entry, "description") || tag(entry, "content:encoded") : tag(entry, "summary") || tag(entry, "content")).slice(0, 1200);
    const relevance = classifyNewsRelevance({ title, summary });
    if (!relevance) continue;
    const id = createHash("sha256").update(url).digest("hex").slice(0, 24);
    records.set(id, {
      id: `news:${id}`, kind: "news", title, url, originalUrl: url, summary, summaryKind: "publisher-excerpt", publisher: source.publisher,
      publishedAt, firstSeenAt: now, observedAt: now, updatedAt,
      sourceId: source.id, discoveryUrl: source.url, relatedUrls: [], topics: [], discoveryGroups: [source.groupId], relevance,
      newsType: /model|foundation|模型/i.test(title) ? "model" : /open.source|release|tool|开源|工具/i.test(title) ? "tooling" : "research",
    });
  }
  if (invalid && invalid === entries.length) throw new Error("公开订阅源条目均缺少有效元数据");
  return { records: [...records.values()], received: entries.length, invalid };
}

export async function collectPublisherNews(previous: ResearchSignalsData, now: string, days: number, fetchText: FetchText,
  options: { force?: boolean; wait?: (ms: number) => Promise<void>; sources?: NewsFeedSource[] } = {}) {
  const records: NewsSignal[] = [], sources: SignalSourceState[] = [];
  const attemptStats = { requests: 0, successes: 0 };
  for (const source of options.sources ?? NEWS_FEED_SOURCES) {
    const old = previous.sources.find(item => item.id === source.id);
    const checked = old?.checkedAt ? Date.parse(old.checkedAt) : NaN;
    if (!options.force && old?.status === "ok" && old.url === source.url && Date.parse(now) >= checked && Date.parse(now) - checked < CACHE_MS) { sources.push(old); continue; }
    if (attemptStats.requests) await options.wait?.(400);
    attemptStats.requests++;
    const base = { id: source.id, name: source.name, kind: "news" as const, url: source.url, checkedAt: now,
      retained: 0, coverage: `直接读取 ${source.publisher} 公开 RSS / Atom 元数据，按医学影像与研究进展规则筛选近 ${days} 天消息；仅能取得订阅源当前保留的条目，不代表完整历史。摘要来自发布方订阅源，原文链接可追溯，未独立核验其技术声明。` };
    try {
      const response = await fetchText(source.url);
      if (response.status < 200 || response.status >= 300) throw new Error("公开订阅源返回失败状态");
      const parsed = parsePublisherFeed(response.body, source, now, days);
      attemptStats.successes++;
      records.push(...parsed.records);
      sources.push({ ...base, status: parsed.invalid ? "partial" : "ok", received: parsed.received,
        lastSuccessAt: now, error: parsed.invalid ? `有 ${parsed.invalid} 条缺少日期或有效原文链接，已跳过这些条目。` : null });
    } catch {
      sources.push({ ...base, status: "error", received: 0, lastSuccessAt: old?.lastSuccessAt ?? null,
        error: "公开订阅源读取或解析失败；保留已有消息，下轮重试。" });
    }
  }
  return { records, sources, attemptStats };
}

function publisherKey(value: string): string {
  const name = normalized(value);
  const source = NEWS_FEED_SOURCES.find(item => [item.publisher, ...item.aliases].some(alias => normalized(alias) === name));
  return source ? normalized(source.publisher) : name;
}
function canonicalLink(record: NewsSignal): string | null {
  const raw = record.originalUrl || record.url;
  if (!safeSignalUrl(raw)) return null;
  const url = new URL(raw);
  if (url.hostname === "news.google.com") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}

/** Enrich a known news identity without deleting saved IDs or resetting first discovery. */
export function mergePublisherNews(records: Map<string, ResearchSignal>, incoming: NewsSignal): void {
  const link = canonicalLink(incoming), publisher = publisherKey(incoming.publisher), title = normalized(incoming.title);
  const exact = records.get(incoming.id);
  const old = exact?.kind === "news" ? exact : [...records.values()].find((item): item is NewsSignal => {
    if (item.kind !== "news") return false;
    const otherLink = canonicalLink(item);
    if (link && otherLink) return link === otherLink;
    return publisherKey(item.publisher) === publisher && normalized(item.title) === title && !!item.publishedAt && !!incoming.publishedAt &&
      Math.abs(Date.parse(item.publishedAt) - Date.parse(incoming.publishedAt)) <= DAY;
  });
  if (!old) { records.set(incoming.id, incoming); return; }
  const preferOld = old.summaryKind === "publisher-excerpt" && incoming.summaryKind !== "publisher-excerpt";
  const oldSummary = preferOld || (!incoming.summary && !!old.summary);
  const preferOldSource = old.sourceId.startsWith("rss-news-") && !incoming.sourceId.startsWith("rss-news-");
  records.set(old.id, { ...old, ...incoming, id: old.id, firstSeenAt: old.firstSeenAt,
    originalUrl: incoming.originalUrl || old.originalUrl,
    discoveryUrl: [incoming.discoveryUrl, old.discoveryUrl].find(url => url && new URL(url).hostname === "news.google.com") || incoming.discoveryUrl || old.discoveryUrl,
    summary: oldSummary ? old.summary : incoming.summary,
    summaryKind: oldSummary ? old.summaryKind : incoming.summaryKind,
    sourceId: preferOldSource ? old.sourceId : incoming.sourceId,
    publisher: preferOldSource ? old.publisher : incoming.publisher,
    url: incoming.originalUrl || old.originalUrl || incoming.url,
    publishedAt: incoming.summaryKind === "publisher-excerpt" ? incoming.publishedAt ?? old.publishedAt : old.publishedAt ?? incoming.publishedAt,
    updatedAt: incoming.updatedAt ?? old.updatedAt,
    discoveryGroups: [...new Set([...(old.discoveryGroups ?? []), ...(incoming.discoveryGroups ?? [])])],
    relatedUrls: [...new Set([...old.relatedUrls, ...incoming.relatedUrls])].slice(0, 40),
  });
}

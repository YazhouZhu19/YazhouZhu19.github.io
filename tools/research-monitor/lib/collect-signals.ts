import { createHash } from "node:crypto";
import { emptyResearchSignalsData, parseResearchSignalsData, safeSignalUrl, SIGNALS_LIMITATIONS,
  type GitHubSignal, type NewsSignal, type ResearchSignal, type ResearchSignalsData, type SignalSourceState } from "./research-signals";

const API = "https://api.github.com";
export const CURATED_REPOSITORIES = ["Project-MONAI/MONAI", "MIC-DKFZ/nnUNet", "bowang-lab/MedSAM", "bowang-lab/MedSAM2", "microsoft/BiomedParse", "microsoft/LLaVA-Med", "StanfordMIMI/Merlin", "wasserth/TotalSegmentator", "Google-Health/medgemma", "Project-MONAI/VISTA"];
export const GITHUB_QUERIES = ['"medical imaging" in:description fork:false archived:false', 'topic:medical-image-analysis fork:false archived:false'];
export const NEWS_QUERIES = [
  { id: "google-news-imaging", name: "Google News · medical imaging", query: '"medical imaging" (model OR AI OR release)', hl: "en-US", gl: "US", ceid: "US:en" },
  { id: "google-news-radiology", name: "Google News · radiology models", query: '(radiology OR pathology) ("foundation model" OR "open source" OR "AI model")', hl: "en-US", gl: "US", ceid: "US:en" },
  { id: "google-news-zh", name: "Google News · 医学影像模型", query: '(医学影像 OR 医疗影像 OR 影像诊断) (模型 OR 开源 OR 发布)', hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
];
const CACHE_MS = 6 * 60 * 60 * 1000;
const RESPONSE_MAX_BYTES = 3 * 1024 * 1024;
export type SignalFetch = (url: string) => Promise<{ body: string; status: number }>;
export type SignalCollectOptions = { now?: Date; fetchText?: SignalFetch; newsDays?: number; force?: boolean; githubToken?: string };

function allowedFetchUrl(value: string) {
  if (!safeSignalUrl(value)) return false;
  const url = new URL(value);
  return (url.hostname === "api.github.com" && (/^\/repos\/[\w.-]+\/[\w.-]+(?:\/(readme|releases\/latest))?$/.test(url.pathname) || url.pathname === "/search/repositories")) ||
    (url.hostname === "news.google.com" && url.pathname === "/rss/search");
}
/** A token is attached only to the GitHub API; redirects are never followed. */
export function createSignalFetcher(token?: string, fetcher: typeof fetch = fetch): SignalFetch {
  return async value => {
    if (!allowedFetchUrl(value)) throw new Error("不支持的公开采集地址");
    const github = new URL(value).hostname === "api.github.com";
    const headers: Record<string, string> = { Accept: github ? "application/vnd.github+json" : "application/rss+xml, application/xml", "User-Agent": "MedicalImageResearchMonitor/3.0 public-metadata" };
    if (github) { headers["X-GitHub-Api-Version"] = "2022-11-28"; if (token) headers.Authorization = `Bearer ${token}`; }
    let response: Response;
    try { response = await fetcher(value, { headers, redirect: "error", signal: AbortSignal.timeout(25000) }); }
    catch { throw new Error("公开来源连接失败或超时；保留已有记录"); }
    if (!response.ok) {
      if (github && response.status === 404 && /\/(readme|releases\/latest)$/.test(new URL(value).pathname)) return { body: "", status: 404 };
      throw new Error(`公开来源返回 HTTP ${response.status}`);
    }
    if (response.url && !allowedFetchUrl(response.url)) throw new Error("来源重定向到不支持的地址");
    if (Number(response.headers.get("content-length")) > RESPONSE_MAX_BYTES) throw new Error("来源响应超过大小上限");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("来源返回空响应");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const { done, value: chunk } = await reader.read(); if (done) break;
        bytes += chunk.byteLength; if (bytes > RESPONSE_MAX_BYTES) { await reader.cancel(); throw new Error("来源响应超过大小上限"); } chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks).toString("utf8");
    if (!body.trim()) throw new Error("来源返回 HTTP 200 但响应为空");
    return { body, status: response.status };
  };
}
const text = (value: unknown, max = 1000) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
const stamp = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function json(body: string): any { try { return JSON.parse(body); } catch { throw new Error("来源 JSON 格式无效"); } }
function shortError(error: unknown) { return error instanceof Error && /^(来源|公开|GitHub|Google|RSS|检索)/.test(error.message) ? error.message.slice(0, 180) : "来源数据无效或请求失败"; }
export function publicRelatedUrls(value: string): string[] {
  const urls = [...value.matchAll(/https:\/\/[^\s<>"'\])}]+/g)].map(match => match[0].replace(/[.,;]+$/, "")).filter(safeSignalUrl);
  return [...new Set(urls)].sort((a, b) => Number(/doi\.org|arxiv\.org|github\.com/.test(b)) - Number(/doi\.org|arxiv\.org|github\.com/.test(a))).slice(0, 40);
}
export function parseGitHubRepository(value: any, observedAt: string): GitHubSignal {
  if (!value || value.private !== false || !/^[\w.-]+\/[\w.-]+$/.test(value.full_name ?? "") || value.html_url?.toLowerCase() !== `https://github.com/${value.full_name}`.toLowerCase() ||
    [value.stargazers_count, value.forks_count, value.open_issues_count].some(item => count(item) === null) || typeof value.archived !== "boolean" || !stamp(value.created_at)) throw new Error("GitHub 仓库响应字段无效");
  return {
    id: `github:${value.full_name.toLowerCase()}`, kind: "github", title: value.full_name, fullName: value.full_name,
    url: value.html_url, summary: text(value.description, 1200), summaryKind: "repository-description", publisher: value.full_name.split("/")[0],
    publishedAt: stamp(value.created_at), firstSeenAt: observedAt, observedAt, updatedAt: stamp(value.updated_at),
    topics: Array.isArray(value.topics) ? value.topics.filter((item: unknown) => typeof item === "string").map((item: string) => item.slice(0, 100)).slice(0, 30) : [],
    sourceId: "github-public", relatedUrls: publicRelatedUrls(text(value.homepage, 2048)),
    stars: value.stargazers_count, forks: value.forks_count, openIssues: value.open_issues_count,
    license: value.license?.spdx_id && value.license.spdx_id !== "NOASSERTION" ? text(value.license.spdx_id, 100) : null,
    language: text(value.language, 100) || null, archived: value.archived, pushedAt: stamp(value.pushed_at),
    releasedAt: null, releaseUrl: null, readmeExcerpt: "",
  };
}
export function isImagingRelevant(value: string): boolean {
  return /medical imag|biomedical imag|medical-image|radiolog|radiograph|chest.x.ray|patholog|histolog|histopatholog|mammograph|computed tomography|magnetic resonance|ultrasound|retinal|fundus|医[学疗]影像|影像诊断|病理|放射|超声|胸片|磁共振/i.test(value);
}
export function isGitHubProjectRelevant(repo: Pick<GitHubSignal, "fullName" | "summary" | "topics">): boolean {
  const value = `${repo.fullName} ${repo.summary} ${repo.topics.join(" ")}`;
  return isImagingRelevant(value) && !/\.github\.io\b|portfolio|course assignment|homework|notes and open discussion|reading list|papers? reading/i.test(value);
}
export function isNewsProgressRelevant(value: string): boolean {
  return isImagingRelevant(value) && /\bmodels?\b|\bAI\b|artificial intelligence|deep learning|foundation|open.source|模型|人工智能|深度学习|开源/i.test(value) &&
    !/\bearnings\b|board of directors|\binvestor conference\b|\bmarket (?:size|share|companies|set for)\b|\btop AI\b.*\bcompanies\b|\bstatistics\b|\b(?:funding|invests|investing)\b|\b(?:raises|bags|picks up) \$|\bnew CEO\b|\bIPO\b|\(\d+\.HK\)|港交所|港股|招股|募资|营收|收入暴涨|新股消息|上市|市值|专精龙头|增长提速/i.test(value);
}
function decode(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, code: string) => {
    if (code.startsWith("#")) { const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? full;
  });
}
const plain = (value: string) => decode(decode(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (value: string, name: string) => value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
export function googleNewsUrl(query: typeof NEWS_QUERIES[number], days: number): string {
  if (!Number.isSafeInteger(days) || days < 1 || days > 730) throw new Error("检索时间跨度必须为 1–730 天");
  return "https://news.google.com/rss/search?" + new URLSearchParams({ q: `${query.query} when:${days}d`, hl: query.hl, gl: query.gl, ceid: query.ceid });
}
export function parseGoogleNewsRss(body: string, sourceId: string, discoveryUrl: string, observedAt: string, days: number): { records: NewsSignal[]; received: number } {
  if (!/<rss\b/i.test(body) || !/<\/rss>\s*$/i.test(body) || !/<channel\b/i.test(body) || !/<\/channel>/i.test(body) || !tag(body, "title") || !tag(body, "link")) throw new Error("Google RSS 响应结构无效");
  const items = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if ((body.match(/<item\b/gi) ?? []).length !== items.length) throw new Error("Google RSS 结果未完整闭合");
  if (items.length > 300) throw new Error("Google RSS 结果超过解析上限");
  const records: NewsSignal[] = []; let invalid = 0;
  for (const [, item] of items) {
    const publisher = plain(tag(item, "source")).slice(0, 200), rawTitle = plain(tag(item, "title")), link = decode(tag(item, "link")).trim(), publishedAt = stamp(plain(tag(item, "pubDate")));
    if (!rawTitle || !publisher || !safeSignalUrl(link) || new URL(link).hostname !== "news.google.com" || !publishedAt) { invalid++; continue; }
    const title = rawTitle.endsWith(` - ${publisher}`) ? rawTitle.slice(0, -publisher.length - 3) : rawTitle;
    const summary = plain(tag(item, "description")).slice(0, 500);
    if (!isNewsProgressRelevant(title + " " + summary)) continue;
    const age = Date.parse(observedAt) - Date.parse(publishedAt);
    if (age < -86400000 || age > (days + 1) * 86400000) continue;
    const id = createHash("sha256").update(`${publisher.toLowerCase()}\n${title.toLowerCase().replace(/\s+/g, " ")}`).digest("hex").slice(0, 24);
    records.push({
      id: `news:${id}`, kind: "news", title: title.slice(0, 500), url: link, summary, summaryKind: "search-snippet", publisher,
      publishedAt, firstSeenAt: observedAt, observedAt, updatedAt: null, topics: [], sourceId,
      relatedUrls: [], newsType: /model|foundation|模型/i.test(title) ? "model" : /open.source|release|tool|开源|工具/i.test(title) ? "tooling" : "research",
      discoveryUrl, originalUrl: null,
    });
  }
  // Malformed rows are not silently accepted as an empty successful collection.
  if (invalid) throw new Error(`Google RSS 含 ${invalid} 条缺少必要元数据的结果`);
  return { records, received: items.length };
}

async function collectGitHub(fetchText: SignalFetch, now: string) {
  const candidates = new Map<string, GitHubSignal>(), errors: string[] = [];
  let received = 0, successes = 0;
  for (const fullName of CURATED_REPOSITORIES) {
    try { const result = parseGitHubRepository(json((await fetchText(`${API}/repos/${fullName}`)).body), now); candidates.set(result.id, result); received++; successes++; }
    catch (error) { errors.push(`${fullName}: ${shortError(error)}`); }
  }
  for (const query of GITHUB_QUERIES) {
    try {
      const value = json((await fetchText(`${API}/search/repositories?${new URLSearchParams({ q: query, sort: "updated", order: "desc", per_page: "12" })}`)).body);
      if (!value || !Array.isArray(value.items) || count(value.total_count) === null || typeof value.incomplete_results !== "boolean") throw new Error("GitHub 搜索响应字段无效");
      if (value.total_count > 0 && !value.items.length) throw new Error("GitHub 搜索声明有结果但返回空列表");
      if (value.incomplete_results) errors.push("GitHub 搜索返回不完整结果");
      for (const item of value.items) {
        const result = parseGitHubRepository(item, now); received++;
        if (isGitHubProjectRelevant(result) && candidates.size < 18) candidates.set(result.id, result);
      }
      successes++;
    } catch (error) { errors.push(shortError(error)); }
  }
  for (const repo of candidates.values()) {
    try {
      const response = await fetchText(`${API}/repos/${repo.fullName}/readme`);
      if (response.status !== 404) {
        const value = json(response.body);
        if (value.encoding !== "base64" || typeof value.content !== "string" || value.content.length > 2 * 1024 * 1024) throw new Error("GitHub README 格式无效");
        const readme = Buffer.from(value.content, "base64").toString("utf8");
        repo.readmeExcerpt = plain(readme.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s*/gm, "")).slice(0, 850);
        repo.relatedUrls = [...new Set([...repo.relatedUrls, ...publicRelatedUrls(readme)])].slice(0, 40);
      }
    } catch (error) { errors.push(`${repo.fullName} README: ${shortError(error)}`); }
    try {
      const response = await fetchText(`${API}/repos/${repo.fullName}/releases/latest`);
      if (response.status !== 404) {
        const value = json(response.body);
        if (value.draft !== false || value.prerelease !== false || !stamp(value.published_at) || !safeSignalUrl(value.html_url) || !value.html_url.startsWith(repo.url + "/releases/")) throw new Error("GitHub release 响应字段无效");
        repo.releasedAt = stamp(value.published_at); repo.releaseUrl = value.html_url;
      }
    } catch (error) { errors.push(`${repo.fullName} release: ${shortError(error)}`); }
  }
  return { records: [...candidates.values()], received, successes, errors };
}
export async function collectResearchSignals(previous: ResearchSignalsData = emptyResearchSignalsData(), options: SignalCollectOptions = {}): Promise<{ data: ResearchSignalsData; allFailed: boolean }> {
  parseResearchSignalsData(previous);
  const now = (options.now ?? new Date()).toISOString(), days = options.newsDays ?? 365;
  const request = options.fetchText ?? createSignalFetcher(options.githubToken);
  // Validation happens before issuing any requests or replacing the snapshot.
  NEWS_QUERIES.forEach(query => googleNewsUrl(query, days));
  const records = new Map(previous.records.map(record => [record.id, record])), sources: SignalSourceState[] = [];
  function merge(incoming: ResearchSignal[]) {
    for (const item of incoming) {
      const old = records.get(item.id);
      records.set(item.id, { ...item, firstSeenAt: old?.firstSeenAt ?? item.firstSeenAt,
        ...(item.kind === "github" && old?.kind === "github" ? {
          readmeExcerpt: item.readmeExcerpt || old.readmeExcerpt,
          relatedUrls: [...new Set([...item.relatedUrls, ...old.relatedUrls])].slice(0, 40),
          releasedAt: item.releasedAt ?? old.releasedAt, releaseUrl: item.releaseUrl ?? old.releaseUrl,
        } : {}),
      });
    }
  }
  function cached(id: string, targetUrl: string) {
    const source = previous.sources.find(item => item.id === id);
    if (!options.force && source?.status === "ok" && source.url === targetUrl && Date.parse(now) - Date.parse(source.checkedAt) >= 0 && Date.parse(now) - Date.parse(source.checkedAt) < CACHE_MS) { sources.push(source); return true; }
    return false;
  }
  const githubUrl = `${API}/search/repositories?${new URLSearchParams({ q: GITHUB_QUERIES[0] })}`;
  if (!cached("github-public", githubUrl)) {
    const result = await collectGitHub(request, now); merge(result.records);
    sources.push({ id: "github-public", name: "GitHub public repositories", kind: "github", url: githubUrl,
      status: result.errors.length ? result.successes ? "partial" : "error" : "ok", checkedAt: now,
      lastSuccessAt: result.errors.length ? previous.sources.find(source => source.id === "github-public")?.lastSuccessAt ?? null : now,
      received: result.received, retained: [...records.values()].filter(item => item.kind === "github").length,
      error: result.errors.length ? result.errors.join("；").slice(0, 1600) : null,
      coverage: "10 个精选公开项目 + 2 个医疗影像关键词搜索（各最多 12 项，最多补充至 18 个项目），排除明确的个人主页/课程作业；抓取当前公开描述、README 短摘和最新非预发布 release。保留既有记录，每 6 小时重新检查。",
    });
  }
  for (const query of NEWS_QUERIES) {
    const url = googleNewsUrl(query, days); if (cached(query.id, url)) continue;
    let received = 0, error: string | null = null;
    try { const parsed = parseGoogleNewsRss((await request(url)).body, query.id, url, now, days); received = parsed.received; merge(parsed.records); }
    catch (cause) { error = shortError(cause); }
    sources.push({ id: query.id, name: query.name, kind: "news", url, status: error ? "error" : "ok", checkedAt: now,
      lastSuccessAt: error ? previous.sources.find(item => item.id === query.id)?.lastSuccessAt ?? null : now,
      received, retained: [...records.values()].filter(item => item.sourceId === query.id).length, error,
      coverage: `Google News 公开 RSS 搜索，查询近 ${days} 天，地区 ${query.gl}、语言 ${query.hl}；仅保留同时含医学影像与 AI/模型线索的标题/检索摘要，排除明显的财报/上市/人事任命，原始正文未核验。规则可能误收或漏收；结果上限由 Google 决定，每 6 小时重查。`,
    });
  }
  // Old configured sources remain discoverable if a future collector removes one.
  for (const source of previous.sources) if (!sources.some(item => item.id === source.id)) sources.push(source);
  const mergedRecords = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  const finalSources = sources.map(source => ({ ...source, retained: mergedRecords.filter(record => record.sourceId === source.id).length }));
  const data = parseResearchSignalsData({ schemaVersion: 1, generatedAt: now, records: mergedRecords, sources: finalSources, limitations: [...SIGNALS_LIMITATIONS] });
  return { data, allFailed: sources.every(source => source.status === "error") };
}
